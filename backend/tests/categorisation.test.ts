import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '../src/lib/db';
import {
  createClassifier, persistClassification, Taxonomy,
  extractEbayCategory, extractIcecatCategory, runRules, buildHaystack,
  validateRules, categoryRules,
} from '../src/categorisation/index';
import { getCategoryProducts, getTree, setProductCategory } from '../src/api/catalog-queries';
import { matchLabelToCategory } from '../src/categorisation/label-match';

/**
 * The categorisation suite.
 *
 * The labelled samples in "rule engine" below are the important part. Every
 * misclassification found in production gets added there BEFORE a rule is
 * written to fix it, so that it stays fixed. That single habit is the
 * difference between a rule engine and a swamp.
 */

const EAN = (n: number) => {
  // 12 digits + check digit. Built from n so every test product is distinct;
  // the naive String(2e12 + n).slice(0,12) collides for every n under 10.
  const base = '20000' + String(n).padStart(7, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  return base + String((10 - (sum % 10)) % 10);
};

async function insertProduct(o: {
  title: string; brand?: string; category?: string; n: number; status?: string;
}): Promise<number> {
  const [row] = await sql<{ id: string }[]>`
    insert into product (ean, brand, title, category, status)
    values (${EAN(o.n)}, ${o.brand ?? 'Acme'}, ${o.title},
            ${o.category ?? 'tech'}, ${o.status ?? 'draft'})
    returning id`;
  return Number(row!.id);
}

beforeAll(async () => {
  // The tree must be seeded by db/007 for any of this to mean anything.
  const [{ c }] = await sql<{ c: string }[]>`select count(*) as c from category`;
  expect(Number(c)).toBeGreaterThan(0);
});

beforeEach(async () => {
  await sql`truncate product_classification, product_category, product_tag,
                     match_review_queue, price_observation, offer, product
            restart identity cascade`;
  await sql`delete from source_category_map`;
  await sql`delete from source_category`;
  await sql`delete from source_category_unmapped`;
  await sql`delete from product_source_category`;
});

// ---------------------------------------------------------------------------
describe('category tree', () => {
  it('seeds the three roots the frontend contract requires', async () => {
    const roots = await sql<{ slug: string }[]>`
      select slug from category where depth = 0 order by slug`;
    expect(roots.map((r) => r.slug)).toEqual(['home', 'sport', 'tech']);
  });

  it("keeps today's live URLs resolvable as paths", async () => {
    for (const path of ['sport/running', 'tech/smartphones', 'home/kitchen-dining']) {
      const [r] = await sql`select path from category where path = ${path}`;
      expect(r, `${path} missing`).toBeTruthy();
    }
  });

  it('cascades a rename to every descendant, at any depth', async () => {
    const [audio] = await sql<{ id: string }[]>`
      select id from category where path = 'tech/audio-headphones'`;
    const [buds] = await sql<{ id: string }[]>`
      insert into category (parent_id, slug, name) values (${audio!.id}, 'testbuds', 'Test Buds')
      returning id`;
    await sql`insert into category (parent_id, slug, name)
              values (${buds!.id}, 'testtrue', 'Test True')`;

    await sql`update category set slug = 'renamedtech' where path = 'tech'`;
    const rows = await sql<{ path: string; depth: number }[]>`
      select path, depth from category where path like 'renamedtech/audio%' order by path`;
    expect(rows.map((r) => r.path)).toEqual([
      'renamedtech/audio-headphones',
      'renamedtech/audio-headphones/testbuds',
      'renamedtech/audio-headphones/testbuds/testtrue',
    ]);
    expect(rows.map((r) => r.depth)).toEqual([1, 2, 3]);

    await sql`update category set slug = 'tech' where slug = 'renamedtech'`;
    await sql`delete from category where path like 'tech/audio-headphones/%'`;
  });

  it('refuses to move a node underneath its own descendant', async () => {
    const [parent] = await sql<{ id: string }[]>`select id from category where path = 'tech'`;
    const [child] = await sql<{ id: string }[]>`
      select id from category where path = 'tech/smartphones'`;
    await expect(
      sql`update category set parent_id = ${child!.id} where id = ${parent!.id}`
    ).rejects.toThrow(/own descendant/);
  });

  it('allows the same slug under different parents but not the same one', async () => {
    const [home] = await sql<{ id: string }[]>`select id from category where path = 'home'`;
    const [sport] = await sql<{ id: string }[]>`select id from category where path = 'sport'`;
    await sql`insert into category (parent_id, slug, name) values (${home!.id}, 'dupe', 'Dupe')`;
    await sql`insert into category (parent_id, slug, name) values (${sport!.id}, 'dupe', 'Dupe')`;
    await expect(
      sql`insert into category (parent_id, slug, name) values (${home!.id}, 'dupe', 'Dupe')`
    ).rejects.toThrow();
    await sql`delete from category where slug = 'dupe'`;
  });
});

// ---------------------------------------------------------------------------
describe('assignments', () => {
  it('enforces exactly one primary category per product', async () => {
    const id = await insertProduct({ title: 'Thing', n: 1 });
    const [a] = await sql<{ id: string }[]>`select id from category where path = 'tech/smartphones'`;
    const [b] = await sql<{ id: string }[]>`select id from category where path = 'tech/cameras'`;

    await sql`insert into product_category (product_id, category_id, relation)
              values (${id}, ${a!.id}, 'primary')`;
    await expect(
      sql`insert into product_category (product_id, category_id, relation)
          values (${id}, ${b!.id}, 'primary')`
    ).rejects.toThrow();
  });

  it('returns one row per product from products_in_category, not one per node', async () => {
    const id = await insertProduct({ title: 'Thing', n: 2, status: 'published' });
    const [leaf] = await sql<{ id: string }[]>`
      select id from category where path = 'tech/smartphones'`;
    const [root] = await sql<{ id: string }[]>`select id from category where path = 'tech'`;
    await sql`insert into product_category (product_id, category_id, relation)
              values (${id}, ${leaf!.id}, 'primary'), (${id}, ${root!.id}, 'ancestor')`;

    const rows = await sql`select * from products_in_category('tech')`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_primary).toBe(true);
  });

  it('keeps the audit trail append-only', async () => {
    const id = await insertProduct({ title: 'Thing', n: 3 });
    await sql`insert into product_classification (product_id, stage, confidence)
              values (${id}, 'rule', 0.9)`;
    await expect(
      sql`update product_classification set confidence = 0.1 where product_id = ${id}`
    ).rejects.toThrow(/append-only/);
  });
});

// ---------------------------------------------------------------------------
describe('source category resolver', () => {
  beforeEach(async () => {
    const [audio] = await sql<{ id: string }[]>`
      select id from category where path = 'tech/audio-headphones'`;
    // A two-level source tree with ONLY the parent mapped.
    await sql`insert into source_category (source_key, external_key, parent_key, label) values
      ('ebay', '15032', null,   'Portable Audio'),
      ('ebay', '112529', '15032', 'Headphones')`;
    await sql`insert into source_category_map (source_key, external_key, category_id, confidence)
              values ('ebay', '15032', ${audio!.id}, 0.900)`;
  });

  it('walks up to a mapped ancestor and charges for the hop', async () => {
    const [exact] = await sql<{ hops: number; confidence: string }[]>`
      select * from resolve_source_category('ebay', '15032')`;
    expect(exact!.hops).toBe(0);
    expect(Number(exact!.confidence)).toBeCloseTo(0.9, 3);

    const [child] = await sql<{ hops: number; confidence: string }[]>`
      select * from resolve_source_category('ebay', '112529')`;
    expect(child!.hops).toBe(1);
    expect(Number(child!.confidence)).toBeCloseTo(0.85, 3);
  });

  it('returns nothing for a key no ancestor maps', async () => {
    const rows = await sql`select * from resolve_source_category('ebay', '999999')`;
    expect(rows).toHaveLength(0);
  });

  it('ranks icecat ahead of ebay from the seeded default row', async () => {
    const [a] = await sql<{ source_rank: number }[]>`
      select source_rank('tech/audio-headphones', 'icecat') as source_rank`;
    const [b] = await sql<{ source_rank: number }[]>`
      select source_rank('tech/audio-headphones', 'ebay') as source_rank`;
    expect(a!.source_rank).toBeLessThan(b!.source_rank);
  });

  it('records unmapped keys and counts repeat sightings', async () => {
    await sql`select note_unmapped_source_category('ebay', '31388', 'Vacuum Cleaners', null)`;
    await sql`select note_unmapped_source_category('ebay', '31388', 'Vacuum Cleaners', null)`;
    const [row] = await sql<{ hits: number }[]>`
      select hits from source_category_unmapped where external_key = '31388'`;
    expect(row!.hits).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe('source extractors', () => {
  it('reads an eBay categoryId, and nothing when there is none', () => {
    expect(extractEbayCategory({ categoryId: '112529', categoryPath: 'Audio|Headphones' }))
      .toEqual([{ sourceKey: 'ebay', externalKey: '112529', label: 'Audio|Headphones' }]);
    expect(extractEbayCategory({})).toEqual([]);
    expect(extractEbayCategory(null)).toEqual([]);
  });

  it('reads Icecat virtual categories before the main one', () => {
    const out = extractIcecatCategory({
      data: {
        GeneralInfo: {
          Category: { CategoryID: 1001, Name: { Value: 'Headphones' } },
          VirtualCategory: [{ VirtualCategoryID: 2002, Value: 'True Wireless' }],
        },
      },
    });
    expect(out.map((s) => s.externalKey)).toEqual(['2002', '1001']);
  });
});

// ---------------------------------------------------------------------------
describe('rule engine', () => {
  it('has no rule pointing at a category that does not exist', async () => {
    const paths = await sql<{ path: string }[]>`select path from category`;
    expect(validateRules(paths.map((p) => p.path))).toEqual([]);
    expect(categoryRules().length).toBeGreaterThan(20);
  });

  // The labelled samples. ADD TO THIS LIST BEFORE ADDING A RULE.
  const SAMPLES: [string, string | null][] = [
    ['Sony WH-1000XM5 Wireless Noise Cancelling Headphones', 'tech/audio-headphones'],
    ['Samsung 55" QLED 4K Smart TV',                          'tech/tv-video'],
    ['Apple iPhone 14 128GB Unlocked Smartphone',              'tech/smartphones'],
    ['Dell XPS 13 Laptop 16GB RAM',                           'tech/laptops-computers'],
    ['Garmin Forerunner 265 GPS Running Watch',               'tech/wearables'],
    ['Philips Airfryer XXL 7.3L heteluchtfriteuse',           'tech/home-appliances'],
    ['Nike Pegasus 41 Running Shoes Heren',                   'sport/running'],
    ['Shimano Racefiets 105 Groepset Road Bike',              'sport/cycling'],
    ['Osprey Talon 22 Hiking Backpack',                       'sport/hiking-outdoor'],
    ['Adjustable Dumbbells 2x 20kg Halterset',                'sport/fitness-gym'],
    ['Speedo Zwembril Swimming Goggles Junior',               'sport/swimming'],
    ['Wilson Pro Staff Tennis Racket',                        'sport/racket-sports'],
    ['IKEA Eettafel Dining Table Oak 180cm',                  'home/furniture'],
    ['Tempur Matras 160x200 Mattress',                        'home/bedroom'],
    ['Philips Hue Smart Bulb E27 Slimme Lamp',                'home/lighting'],

    // ---- accessory traps: each one is a `none` list doing its job ----
    ['Universal TV Wall Bracket Muurbeugel 32-65 inch',       'tech/tv-video'],
    ['Silicone Phone Case for iPhone 14 Telefoonhoesje',      'tech/smartphones'],
    ['Laptop Sleeve 13 inch Neoprene Case',                   null],
    ['Replacement Ear Pads for Sony Headphones Oorkussens',   null],

    // ---- deliberate no-match ----
    ['Assorted vintage postcards lot of 40',                  null],
    ['Handmade ceramic figurine, signed',                     null],

    // ---- REAL titles from the first production dry run -------------------
    // Every one of these was a miss. They are here BEFORE the rules that fix
    // them, which is the habit that keeps the rule file from becoming a swamp.
    // False negatives: sellers write "trainers"/"sneakers", not "running shoes".
    ["adidas Ultraboost 22 Men's Trainers Shoes Indigo Blue GX3061", 'sport/running'],
    ['Adidas Ultraboost 22 Mens Running Trainers Sneakers GX5573',   'sport/running'],
    ['ON Running Cloud 6 3MF10070070 [EU 46 UK 11 US 11.5] Shoes',   'sport/running'],
    ['Osprey Talon 22 S / M Rucksack Fahrradrucksack Tasche Limon',  'sport/hiking-outdoor'],
    ["Osprey Talon Velocity 20L Men's Multi-Sport Backpack",         'sport/hiking-outdoor'],
    ['Clear Storage Boxes with Lids Stackable Container Home Office','home/storage'],

    // False POSITIVES — worse than a miss, because they publish something wrong.
    // A pack of trading cards is not sports equipment.
    ['2025 PANINI PRIZM WNBA Basketball 4 Pack Caitlin Clark Tin',   null],
    // A set of sofa COVERS is not a sofa — but it IS a soft furnishing.
    ['7 Seater Jacquard L Shape Sofa Covers 3-Piece Sectional Sofa', 'home/home-textiles'],

    // ---- second production dry run ---------------------------------------
    // REGRESSION: 'leg' was in the furniture guard list for replacement parts.
    // Once matching went plural-tolerant it started matching "Wooden Legs" and
    // threw out real dining tables. Guard the part, not the word.
    ['TROMSO 80cm Round Dining Table Scandi Wooden Legs Small Kitchen', 'home/furniture'],
    // German titles arrive from eBay DE and are as valid an input as Dutch.
    ['7 Zonen Taschenfederkern Matratze Deluxe 80x200 90x200',       'home/bedroom'],
    ['7-Zonen Kaltschaum Matratze H2 H3 H4 H5 H6 90x200 120x200',    'home/bedroom'],
    // The category word is often missing: "Pendant" not "pendant light",
    // "Mirrorless" not "mirrorless camera", "Mediaplayer" as one word.
    ['EGLO Hortunas 4 Light LED Pendant Black Steel Smoked Glass',   'home/lighting'],
    ['[ Excellent ] OLYMPUS PEN Lite E-PL7 White Mirrorless Digital','tech/cameras'],
    ['Google TV Mediaplayer Streaming Box WLAN Mecool MEON 4K UHD',  'tech/tv-video'],
    ['Duvet Cover Set Black With Gold Marble Foil Luxury Bedding',   'home/home-textiles'],
    ['BLANCO Envoy BM1626 Kitchen Mixer Tap Brushed Nickel Steel',   'home/kitchen-dining'],
    ['Dualit Kitchen Hand Mixer 4 Speed 400W Whisk Beaters Dough',   'tech/home-appliances'],
    // Still correctly unplaced: this is a cover FOR a parasol, not a parasol.
    ['Heavy Duty Outdoor Cantilever Parasol Umbrella Cover Beige',   null],
  ];

  for (const [title, expected] of SAMPLES) {
    it(`classifies: ${title}`, () => {
      const run = runRules(buildHaystack({ title }));
      expect(run.best?.category ?? null).toBe(expected);
    });
  }

  it('puts accessories below the real thing rather than beside it', () => {
    const phone = runRules(buildHaystack({ title: 'Apple iPhone 14 Smartphone' }));
    const cover = runRules(buildHaystack({ title: 'Phone Case for iPhone 14' }));
    // Both land under smartphones, but the accessory rule is deliberately
    // low-priority and low-confidence so it never outranks a real device.
    expect(phone.best!.confidence).toBeGreaterThan(cover.best!.confidence);
  });

  it('assigns lexical tags independently of the category', () => {
    const run = runRules(buildHaystack({
      title: 'Bose QuietComfort Wireless Noise Cancelling Headphones, refurbished',
    }));
    const slugs = run.tags.map((t) => t.slug);
    expect(slugs).toContain('wireless');
    expect(slugs).toContain('noise-cancelling');
    expect(slugs).toContain('refurbished');
  });

  it('matches Dutch listing titles', () => {
    const run = runRules(buildHaystack({ title: 'Draadloze koptelefoon met ruisonderdrukking' }));
    expect(run.best?.category).toBe('tech/audio-headphones');
    expect(run.tags.map((t) => t.slug)).toContain('noise-cancelling');
  });
});

// ---------------------------------------------------------------------------
describe('orchestrator and publish gate', () => {
  it('lets a mapped source category win, and publishes it', async () => {
    const [cams] = await sql<{ id: string }[]>`select id from category where path = 'tech/cameras'`;
    await sql`insert into source_category (source_key, external_key, label)
              values ('ebay', '31388', 'Digital Cameras')`;
    await sql`insert into source_category_map (source_key, external_key, category_id, confidence)
              values ('ebay', '31388', ${cams!.id}, 0.900)`;

    const id = await insertProduct({ title: 'Some Imaging Device', n: 10 });
    const classifier = await createClassifier(sql);
    const result = await classifier.classify({
      productId: String(id),
      title: 'Some Imaging Device',
      sourceCategories: [{ sourceKey: 'ebay', externalKey: '31388', label: 'Digital Cameras' }],
    });

    expect(result.stage).toBe('source');
    expect(result.categoryPath).toBe('tech/cameras');
    expect(result.needsReview).toBe(false);

    await persistClassification(sql, classifier.taxonomy, result);
    const [p] = await sql<{ status: string; category: string; subcategory: string }[]>`
      select status, category, subcategory from product where id = ${id}`;
    expect(p!.status).toBe('published');
    // The legacy columns are mirrored so Josh's frontend keeps working.
    expect(p!.category).toBe('tech');
    expect(p!.subcategory).toBe('cameras');
  });

  it('writes an ancestor row for every level above the primary', async () => {
    const id = await insertProduct({ title: 'Sony Wireless Headphones', n: 11 });
    const classifier = await createClassifier(sql);
    const result = await classifier.classify({ productId: String(id), title: 'Sony Wireless Headphones' });
    await persistClassification(sql, classifier.taxonomy, result);

    const rows = await sql<{ path: string; relation: string }[]>`
      select c.path, pc.relation from product_category pc
        join category c on c.id = pc.category_id
       where pc.product_id = ${id} order by c.depth`;
    expect(rows.map((r) => [r.path, r.relation])).toEqual([
      ['tech', 'ancestor'],
      ['tech/audio-headphones', 'primary'],
    ]);
  });

  it('lets a deeper rule refine a shallower source match', async () => {
    const [tech] = await sql<{ id: string }[]>`select id from category where path = 'tech'`;
    await sql`insert into source_category (source_key, external_key, label)
              values ('ebay', '293', 'Consumer Electronics')`;
    await sql`insert into source_category_map (source_key, external_key, category_id, confidence)
              values ('ebay', '293', ${tech!.id}, 0.900)`;

    const id = await insertProduct({ title: 'Sony Wireless Headphones WH-1000XM5', n: 12 });
    const classifier = await createClassifier(sql);
    const result = await classifier.classify({
      productId: String(id),
      title: 'Sony Wireless Headphones WH-1000XM5',
      sourceCategories: [{ sourceKey: 'ebay', externalKey: '293', label: 'Consumer Electronics' }],
    });
    expect(result.categoryPath).toBe('tech/audio-headphones');
  });

  it('keeps an unplaceable product in draft and queues it for review', async () => {
    const id = await insertProduct({ title: 'Assorted vintage postcards lot of 40', n: 13 });
    const classifier = await createClassifier(sql);
    const result = await classifier.classify({
      productId: String(id), title: 'Assorted vintage postcards lot of 40',
    });
    expect(result.categoryPath).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.reason).toBe('no_rule');

    await persistClassification(sql, classifier.taxonomy, result);
    const [p] = await sql<{ status: string }[]>`select status from product where id = ${id}`;
    expect(p!.status).toBe('draft');

    const [qrow] = await sql<{ reason: string; kind: string }[]>`
      select reason, kind from match_review_queue where product_id = ${id}`;
    expect(qrow!.kind).toBe('category');
    expect(qrow!.reason).toBe('no_rule');
  });

  it('records an unmapped source key as work to do', async () => {
    const id = await insertProduct({ title: 'Mysterious Object', n: 14 });
    const classifier = await createClassifier(sql);
    await classifier.classify({
      productId: String(id),
      title: 'Mysterious Object',
      sourceCategories: [{ sourceKey: 'ebay', externalKey: '77777', label: 'Odd Things' }],
    });
    const [row] = await sql<{ hits: number; external_label: string }[]>`
      select hits, external_label from source_category_unmapped where external_key = '77777'`;
    expect(row!.hits).toBe(1);
    expect(row!.external_label).toBe('Odd Things');
  });

  it('flags a genuine cross-branch conflict rather than picking silently', async () => {
    const [wear] = await sql<{ id: string }[]>`select id from category where path = 'tech/wearables'`;
    const [run] = await sql<{ id: string }[]>`select id from category where path = 'sport/running'`;
    await sql`insert into source_category (source_key, external_key, label) values
      ('icecat', '500', 'Smartwatches'), ('ebay', '600', 'Running')`;
    await sql`insert into source_category_map (source_key, external_key, category_id, confidence) values
      ('icecat', '500', ${wear!.id}, 0.900), ('ebay', '600', ${run!.id}, 0.900)`;

    const id = await insertProduct({ title: 'Ambiguous Wrist Device', n: 15 });
    const classifier = await createClassifier(sql);
    const result = await classifier.classify({
      productId: String(id),
      title: 'Ambiguous Wrist Device',
      sourceCategories: [
        { sourceKey: 'icecat', externalKey: '500' },
        { sourceKey: 'ebay', externalKey: '600' },
      ],
    });
    expect(result.agreement).toBe('conflict');
    expect(result.needsReview).toBe(true);
    expect(result.reason).toBe('source_conflict');
    // Icecat outranks eBay by the precedence table, so it still picks one.
    expect(result.categoryPath).toBe('tech/wearables');
  });

  it('adds the agreement bonus when two sources land on the same node', async () => {
    const [cams] = await sql<{ id: string }[]>`select id from category where path = 'tech/cameras'`;
    await sql`insert into source_category (source_key, external_key) values
      ('icecat', '700'), ('ebay', '800')`;
    await sql`insert into source_category_map (source_key, external_key, category_id, confidence) values
      ('icecat', '700', ${cams!.id}, 0.900), ('ebay', '800', ${cams!.id}, 0.900)`;

    const id = await insertProduct({ title: 'Imaging Device Two', n: 16 });
    const classifier = await createClassifier(sql);
    const result = await classifier.classify({
      productId: String(id),
      title: 'Imaging Device Two',
      sourceCategories: [
        { sourceKey: 'icecat', externalKey: '700' },
        { sourceKey: 'ebay', externalKey: '800' },
      ],
    });
    expect(result.agreement).toBe('agree');
    expect(result.confidence).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
describe('human overrides', () => {
  it('never lets a later classification run move a product a person placed', async () => {
    const id = await insertProduct({ title: 'Sony Wireless Headphones', n: 20 });
    const classifier = await createClassifier(sql);

    const first = await classifier.classify({ productId: String(id), title: 'Sony Wireless Headphones' });
    await persistClassification(sql, classifier.taxonomy, first);
    expect(first.categoryPath).toBe('tech/audio-headphones');

    // A person disagrees and moves it.
    const moved = await setProductCategory(String(id), 'tech/gaming', 'lorenzo');
    expect(moved.ok).toBe(true);

    // The classifier runs again and must not undo that.
    const second = await classifier.classify({ productId: String(id), title: 'Sony Wireless Headphones' });
    await persistClassification(sql, classifier.taxonomy, second);

    const [row] = await sql<{ path: string; stage: string }[]>`
      select c.path, pc.stage from product_category pc
        join category c on c.id = pc.category_id
       where pc.product_id = ${id} and pc.relation = 'primary'`;
    expect(row!.path).toBe('tech/gaming');
    expect(row!.stage).toBe('manual');
  });

  it('still adds tags to a human-curated product', async () => {
    const id = await insertProduct({ title: 'Wireless Noise Cancelling Headphones', n: 21 });
    await setProductCategory(String(id), 'tech/gaming', 'lorenzo');

    const classifier = await createClassifier(sql);
    const result = await classifier.classify({
      productId: String(id), title: 'Wireless Noise Cancelling Headphones',
    });
    await persistClassification(sql, classifier.taxonomy, result);

    const tags = await sql<{ slug: string }[]>`
      select t.slug from product_tag pt join tag t on t.id = pt.tag_id
       where pt.product_id = ${id}`;
    expect(tags.map((t) => t.slug)).toContain('noise-cancelling');
  });
});

// ---------------------------------------------------------------------------
describe('browse read model', () => {
  it('returns products from a node and everything below it, once each', async () => {
    const classifier = await createClassifier(sql);
    for (const [i, title] of [
      'Sony Wireless Headphones', 'Bose Bluetooth Speaker', 'Nike Running Shoes',
    ].entries()) {
      const id = await insertProduct({ title, n: 30 + i });
      const r = await classifier.classify({ productId: String(id), title });
      await persistClassification(sql, classifier.taxonomy, r);
    }

    const tech = await getCategoryProducts('tech');
    expect(tech!.total).toBe(2);
    expect(new Set(tech!.products.map((p) => p.id)).size).toBe(2);

    const audio = await getCategoryProducts('tech/audio-headphones');
    expect(audio!.total).toBe(2);

    const sport = await getCategoryProducts('sport');
    expect(sport!.total).toBe(1);
  });

  it('filters by tag', async () => {
    const classifier = await createClassifier(sql);
    for (const [i, title] of [
      'Sony Wireless Noise Cancelling Headphones', 'Wired Studio Headphones',
    ].entries()) {
      const id = await insertProduct({ title, n: 40 + i });
      const r = await classifier.classify({ productId: String(id), title });
      await persistClassification(sql, classifier.taxonomy, r);
    }
    const filtered = await getCategoryProducts('tech', { tags: ['noise-cancelling'] });
    expect(filtered!.total).toBe(1);
  });

  it('pages instead of returning the whole catalogue', async () => {
    const classifier = await createClassifier(sql);
    for (let i = 0; i < 5; i++) {
      const title = `Wireless Headphones Model ${i}`;
      const id = await insertProduct({ title, n: 50 + i });
      const r = await classifier.classify({ productId: String(id), title });
      await persistClassification(sql, classifier.taxonomy, r);
    }
    const page = await getCategoryProducts('tech', { limit: 2, offset: 0 });
    expect(page!.total).toBe(5);
    expect(page!.products).toHaveLength(2);

    const second = await getCategoryProducts('tech', { limit: 2, offset: 4 });
    expect(second!.products).toHaveLength(1);
  });

  it('never shows a draft product', async () => {
    const id = await insertProduct({ title: 'Sony Wireless Headphones', n: 60 });
    const classifier = await createClassifier(sql);
    const r = await classifier.classify({ productId: String(id), title: 'Sony Wireless Headphones' });
    await persistClassification(sql, classifier.taxonomy, r);
    await sql`update product set status = 'draft' where id = ${id}`;

    const page = await getCategoryProducts('tech');
    expect(page!.total).toBe(0);
  });

  it('returns a nested tree with per-node counts', async () => {
    const tree = await getTree();
    expect(tree.map((t) => t.slug).sort()).toEqual(['home', 'sport', 'tech']);
    const tech = tree.find((t) => t.slug === 'tech')!;
    expect(tech.children!.length).toBeGreaterThan(4);
  });
});

// ---------------------------------------------------------------------------
describe('mapping a source taxonomy (the part that scales)', () => {
  it('classifies from a stored source signal without any keyword matching', async () => {
    const [audio] = await sql<{ id: string }[]>`
      select id from category where path = 'tech/audio-headphones'`;

    // eBay's own tree: a leaf under a parent, only the PARENT mapped.
    await sql`insert into source_category (source_key, external_key, parent_key, label) values
      ('ebay', '15032',  null,    'Portable Audio & Headphones'),
      ('ebay', '112529', '15032', 'Headphones')`;
    await sql`insert into source_category_map (source_key, external_key, category_id, confidence)
              values ('ebay', '15032', ${audio!.id}, 0.900)`;

    // A title no keyword rule could ever place.
    const id = await insertProduct({ title: 'Nothing CMF Buds 2a XZ-991 Light Grey', n: 70 });
    await sql`insert into product_source_category
                (product_id, source_key, external_key, external_label)
              values (${id}, 'ebay', '112529', 'Headphones')`;

    const signals = await sql<{ source_key: string; external_key: string; label: string | null }[]>`
      select * from product_source_signals(${id}::bigint)`;
    expect(signals).toHaveLength(1);

    const classifier = await createClassifier(sql);
    const result = await classifier.classify({
      productId: String(id),
      title: 'Nothing CMF Buds 2a XZ-991 Light Grey',
      sourceCategories: signals.map((s) => ({
        sourceKey: s.source_key, externalKey: s.external_key, label: s.label,
      })),
    });

    // Placed by the SOURCE, one hop up their tree, not by a keyword.
    expect(result.stage).toBe('source');
    expect(result.categoryPath).toBe('tech/audio-headphones');
    expect(result.confidence).toBeCloseTo(0.85, 2);
  });

  it('moves every product under a mapping when the mapping is corrected', async () => {
    const [wrong] = await sql<{ id: string }[]>`select id from category where path = 'tech/gaming'`;
    const [right] = await sql<{ id: string }[]>`select id from category where path = 'tech/cameras'`;

    await sql`insert into source_category (source_key, external_key, label)
              values ('ebay', '31388', 'Digital Cameras')`;
    await sql`insert into source_category_map (source_key, external_key, category_id, confidence)
              values ('ebay', '31388', ${wrong!.id}, 0.900)`;

    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await insertProduct({ title: `Imaging Device ${i}`, n: 80 + i });
      await sql`insert into product_source_category (product_id, source_key, external_key)
                values (${id}, 'ebay', '31388')`;
      ids.push(id);
    }

    const classify = async () => {
      const c = await createClassifier(sql);
      for (const id of ids) {
        const signals = await sql<{ source_key: string; external_key: string; label: string | null }[]>`
          select * from product_source_signals(${id}::bigint)`;
        const r = await c.classify({
          productId: String(id), title: 'Imaging Device',
          sourceCategories: signals.map((s) => ({
            sourceKey: s.source_key, externalKey: s.external_key, label: s.label,
          })),
        });
        await persistClassification(sql, c.taxonomy, r);
      }
    };

    await classify();
    let rows = await sql<{ path: string }[]>`
      select c.path from product_category pc join category c on c.id = pc.category_id
       where pc.product_id = any(${ids}) and pc.relation = 'primary'`;
    expect(rows.every((r) => r.path === 'tech/gaming')).toBe(true);

    // ONE row changes. No re-fetch, no re-ingest.
    await sql`update source_category_map set category_id = ${right!.id}
               where source_key = 'ebay' and external_key = '31388'`;
    await classify();

    rows = await sql<{ path: string }[]>`
      select c.path from product_category pc join category c on c.id = pc.category_id
       where pc.product_id = any(${ids}) and pc.relation = 'primary'`;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.path === 'tech/cameras')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('auto-proposing mappings from their category names', () => {
  it('matches a source category label onto our tree', async () => {
    const taxonomy = await Taxonomy.load(sql);
    const cases: [string, string, string][] = [
      ['Headphones',          'Consumer Electronics > Portable Audio & Headphones', 'tech/audio-headphones'],
      ['Televisions',         'Consumer Electronics > TV, Video & Home Audio',      'tech/tv-video'],
      ['Mattresses',          'Home, Furniture & DIY > Furniture > Beds',           'home/bedroom'],
      ['Running Shoes',       'Sporting Goods > Running',                           'sport/running'],
    ];
    for (const [leaf, crumb, expected] of cases) {
      const m = matchLabelToCategory(taxonomy, leaf, crumb);
      expect(m?.categoryPath, `${leaf} -> ${m?.categoryPath}`).toBe(expected);
      // Always below a human-confirmed mapping.
      expect(m!.confidence).toBeLessThan(0.9);
    }
  });

  it('refuses to guess when nothing matches', async () => {
    const taxonomy = await Taxonomy.load(sql);
    expect(matchLabelToCategory(taxonomy, 'Collectible Card Games', 'Toys & Games')).toBeNull();
    expect(matchLabelToCategory(taxonomy, 'Other', 'Everything Else')).toBeNull();
  });
});
