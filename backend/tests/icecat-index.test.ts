import { describe, expect, it } from 'vitest';
import { parseIndexRows } from '../src/ingest/discover-icecat';
import { extractCategories } from '../src/ingest/list-icecat-categories';
import { assertValidTarget, parseMappingArg } from '../src/ingest/source-category-map';

/**
 * The Icecat index parser is the one part of the discovery pass written from
 * documentation rather than a live response, so it's the part most likely to be
 * wrong — and the part that fails silently ("0 rows parsed") rather than loudly.
 * These tests pin both documented shapes against known-good barcodes, so that
 * fixing the parser for a real download can't quietly break the other shape.
 */

const OCI_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<icecat-interface>
 <files.index>
  <file path="export/level4/EN/1.xml" Product_ID="1" Updated="20260101"
        Quality="ICECAT" Supplier_id="1" Supplier_name="Apple"
        Prod_ID="MQ4H3" Catid="4" Model_Name="iPhone 15">
    <Country_Markets><Country_Market Value="NL"/></Country_Markets>
    <EAN_UPCS><EAN_UPC Value="0194253715214"/></EAN_UPCS>
  </file>
  <file path="export/level4/EN/2.xml" Product_ID="2" Supplier_id="7"
        Supplier_name="Sony" Catid="15" Model_Name="WH-1000XM5">
    <EAN_UPCS>
      <EAN_UPC Value="NOT-A-BARCODE"/>
      <EAN_UPC Value="4901780874316"/>
    </EAN_UPCS>
  </file>
  <file path="export/level4/EN/3.xml" Product_ID="3" Supplier_id="8" Catid="777"/>
 </files.index>
</icecat-interface>`;

const FLAT_INDEX = `<?xml version="1.0"?>
<index>
  <Product Product_ID="9" Supplier_id="1" Supplier_name="Philips"
           Category_ID="777" GTIN="8710103981633" />
  <Product Product_ID="10" Supplier_id="1" Category_ID="4" GTIN="0194253408239" />
</index>`;

describe('parseIndexRows', () => {
  it('reads the documented <file> shape, with barcodes nested in EAN_UPCS', () => {
    const rows = parseIndexRows(OCI_INDEX);
    expect(rows).toEqual([
      { gtin: '0194253715214', icecatCategoryId: '4', brand: 'Apple' },
      { gtin: '4901780874316', icecatCategoryId: '15', brand: 'Sony' },
    ]);
  });

  it('prefers a valid EAN-13 over junk when a product lists several barcodes', () => {
    const rows = parseIndexRows(OCI_INDEX);
    expect(rows.map((r) => r.gtin)).not.toContain('NOT-A-BARCODE');
  });

  it('skips rows with no barcode at all rather than inventing one', () => {
    // Product_ID 3 has a Catid but no EAN_UPCS: unusable for matching.
    expect(parseIndexRows(OCI_INDEX)).toHaveLength(2);
  });

  it('reads the flat <Product GTIN=... Category_ID=...> shape too', () => {
    const rows = parseIndexRows(FLAT_INDEX);
    expect(rows).toEqual([
      { gtin: '8710103981633', icecatCategoryId: '777', brand: 'Philips' },
      { gtin: '0194253408239', icecatCategoryId: '4', brand: null },
    ]);
  });

  it('deduplicates a barcode that appears in both shapes', () => {
    const rows = parseIndexRows(OCI_INDEX + FLAT_INDEX + OCI_INDEX);
    expect(rows.map((r) => r.gtin).sort()).toEqual([
      '0194253408239', '0194253715214', '4901780874316', '8710103981633',
    ]);
  });

  it('returns nothing for a document it does not recognise, instead of throwing', () => {
    expect(parseIndexRows('<html><body>Access denied</body></html>')).toEqual([]);
  });
});

describe('extractCategories', () => {
  it('prefers the English name and keeps the numeric id', () => {
    const xml = `<Response><CategoriesList>
      <Category ID="4"><Name langid="7" Value="Smartphones NL"/><Name langid="1" Value="Smartphones"/></Category>
      <Category ID="15"><Name langid="1" Value="Headphones"/></Category>
    </CategoriesList></Response>`;
    expect(extractCategories(xml)).toEqual([
      { id: '4', name: 'Smartphones' },
      { id: '15', name: 'Headphones' },
    ]);
  });
});

describe('category mapping arguments', () => {
  it('parses the id=category/subcategory shorthand', () => {
    expect(parseMappingArg('4=tech/smartphones')).toEqual({
      sourceCategoryId: '4',
      category: 'tech',
      subcategory: 'smartphones',
    });
  });

  it('rejects a subcategory the front end cannot render', () => {
    // The whole point of validating here: a typo must fail before it writes
    // rows the browse page can never show.
    expect(() => assertValidTarget('tech', 'smartfones')).toThrow(/not a subcategory of tech/);
    expect(() => assertValidTarget('gadgets', 'smartphones')).toThrow(/not a Scoopt category/);
  });

  it('accepts every real subcategory id', () => {
    expect(() => assertValidTarget('sport', 'winter-sports')).not.toThrow();
    expect(() => assertValidTarget('home', 'garden-outdoor')).not.toThrow();
    expect(() => assertValidTarget('tech', 'home-appliances')).not.toThrow();
  });
});
