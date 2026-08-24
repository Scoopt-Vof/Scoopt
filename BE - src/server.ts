import { createServer } from 'node:http';
import { productHandler, searchHandler, priceHistoryHandler, trackHandler } from './api/handlers';
import { sql } from './lib/db';

/**
 * A ~50-line HTTP server so you can run and curl this back end on its own,
 * without Next.js and without Josh's front end.
 *
 * This file is scaffolding for the trial run. In the real repo, Next.js is the
 * server and this file is deleted — the handlers it calls are unchanged.
 *
 * Run:  npm run dev    →  http://localhost:3001
 */
const PORT = Number(process.env.PORT ?? 3001);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const request = new Request(url, {
    method: req.method,
    headers: req.headers as any,
    body: req.method === 'POST' ? await readBody(req) : undefined,
  });

  let response: Response;
  try {
    const path = url.pathname;
    const product = path.match(/^\/api\/product\/([^/]+)$/);
    const history = path.match(/^\/api\/price-history\/([^/]+)$/);

    if (product) response = await productHandler(request, product[1]);
    else if (history) response = await priceHistoryHandler(request, history[1]);
    else if (path === '/api/search') response = await searchHandler(request);
    else if (path === '/api/track' && req.method === 'POST') response = await trackHandler(request);
    else if (path === '/health') response = new Response('ok');
    else response = new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  } catch (err) {
    console.error(err);
    response = new Response(JSON.stringify({ error: 'internal error' }), { status: 500 });
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  res.writeHead(response.status, headers);
  res.end(await response.text());
});

function readBody(req: any): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c));
    req.on('end', () => resolve(data));
  });
}

server.listen(PORT, () => console.log(`Scoopt back end on http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { await sql.end(); server.close(() => process.exit(0)); });
}
