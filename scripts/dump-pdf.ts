import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { extractLines } from '../src/parsers/pdfText';

// Usage: npm run dump -- fixtures/sbi/savings.pdf
// The password is looked up in fixtures/passwords.json, so it never appears on the command line.
const file = process.argv[2];
if (!file) {
  console.error('usage: npm run dump -- <pdf>');
  process.exit(1);
}
const rel = path.relative(path.resolve('fixtures'), path.resolve(file)).split(path.sep).join('/');
const pwFile = path.resolve('fixtures/passwords.json');
const password = existsSync(pwFile)
  ? (JSON.parse(readFileSync(pwFile, 'utf8')) as Record<string, string>)[rel]
  : undefined;

const lines = await extractLines(new Uint8Array(readFileSync(file)), password);
let page = 0;
for (const l of lines) {
  if (l.page !== page) {
    page = l.page;
    console.log(`=== page ${page}`);
  }
  console.log(l.y.toFixed(1).padStart(6), l.cells.map((c) => `[${c.x.toFixed(0)}-${c.xe.toFixed(0)}]${c.s}`).join(' | '));
}
