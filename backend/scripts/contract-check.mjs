/**
 * Fails if the back end's copy of the contract has drifted from the front end's.
 *
 *   npm run contract:check
 *
 * backend/src/contract/frontend-types.ts is a verbatim copy of
 * frontend/contract/types.ts plus a short header saying so. This compares the
 * two, ignoring that header and line-ending differences, and exits 1 with the
 * first differing line if they disagree. Run it before merging any change to
 * either file, or wire it into CI.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const frontendPath = fileURLToPath(new URL('../../frontend/contract/types.ts', import.meta.url));
const backendPath = fileURLToPath(new URL('../src/contract/frontend-types.ts', import.meta.url));

const lines = async (p) => (await readFile(p, 'utf8')).replace(/\r\n/g, '\n').split('\n');

const front = await lines(frontendPath);
let back = await lines(backendPath);

// Drop the backend-only header: everything before the frontend file's first line.
const start = back.indexOf(front[0]);
if (start === -1) {
  console.error(`contract:check — could not find the start of ${frontendPath} inside ${backendPath}`);
  process.exit(1);
}
back = back.slice(start);

const trimEnd = (arr) => { while (arr.length && arr.at(-1).trim() === '') arr.pop(); return arr; };
trimEnd(front); trimEnd(back);

const n = Math.max(front.length, back.length);
for (let i = 0; i < n; i++) {
  if (front[i] !== back[i]) {
    console.error('contract:check — the two contract copies differ.');
    console.error(`  first difference at frontend line ${i + 1}:`);
    console.error(`    frontend: ${front[i] ?? '(end of file)'}`);
    console.error(`    backend:  ${back[i] ?? '(end of file)'}`);
    console.error('  Re-copy frontend/contract/types.ts into backend/src/contract/frontend-types.ts (keep the header).');
    process.exit(1);
  }
}
console.log('contract:check — backend copy matches frontend/contract/types.ts');
