// Renders a product's specs as a simple two-column table on the product page.
// The backend already merges Icecat specs into Product.specs (finding U9) — the
// page just never showed them. Customers like reading the detail, so we show it,
// with the attribution Icecat's licence expects (see G13).

export default function ProductSpecs({ specs }: { specs?: Record<string, string> }) {
  const entries = Object.entries(specs ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== ""
  );
  if (entries.length === 0) return null;

  return (
    <div className="specs">
      <h2 className="specs-title">Specifications</h2>
      <table className="specs-table">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <th scope="row">{key}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="specs-source">Product specifications provided by Icecat.</p>
    </div>
  );
}
