import type { ParsedFile, SourceId } from './types';
import { extractLines, linesText, PdfPasswordError, type Line } from './pdfText';
import { detectSbi, parseSbi } from './sbi';
import { detectFederal, parseFederal } from './federal';
import { detectIciciCard, parseIciciCard } from './iciciCard';
import { detectUbiSavings, parseUbiSavings } from './ubiSavings';
import { detectUbiLoan, parseUbiLoan } from './ubiLoan';
import { detectUbiCertificate, parseUbiCertificate } from './ubiCertificate';
import { detectEpf, parseEpf } from './epf';
import { detectCas, parseCas } from './cas';
import { detectEtradeStatement, parseEtradeStatement } from './etradeStatement';
import { detectBenefitHistory, parseBenefitHistory, readWorkbook } from './benefitHistory';
import { extractSpreadsheet, looksLikeCsv, type SpreadsheetTable } from './spreadsheet';
import { parseGeneric, type GenericMapping } from './generic';

export * from './types';
export type { GenericMapping, SpreadsheetTable };
export { mappingFromGuess, parseGeneric } from './generic';
export { guessMapping } from './spreadsheet';

export interface ParseOptions {
  /** Password typed by the user for this file. */
  password?: string;
  /** Skip detection and use this source (user picked it manually). */
  forceSource?: SourceId;
  /** Column mapping for a CSV/XLSX that is not a known statement. */
  mapping?: GenericMapping;
}

export type ParseOutcome =
  | { status: 'ok'; result: ParsedFile; passwordUsed?: string }
  | { status: 'password-required' }
  | { status: 'password-incorrect' }
  | { status: 'unknown'; reason: string }
  | { status: 'error'; source: SourceId; message: string }
  | { status: 'need-mapping'; table: SpreadsheetTable };

type PdfSource = Exclude<SourceId, 'etrade-xlsx' | 'generic'>;

// Order matters only for ties: more specific sources first.
export const PDF_PARSERS: { source: PdfSource; detect: (text: string) => number; parse: (lines: Line[]) => ParsedFile }[] = [
  { source: 'ubi-cert', detect: detectUbiCertificate, parse: parseUbiCertificate },
  { source: 'ubi-loan', detect: detectUbiLoan, parse: parseUbiLoan },
  { source: 'ubi-savings', detect: detectUbiSavings, parse: parseUbiSavings },
  { source: 'sbi', detect: detectSbi, parse: parseSbi },
  { source: 'federal', detect: detectFederal, parse: parseFederal },
  { source: 'icici-cc', detect: detectIciciCard, parse: parseIciciCard },
  { source: 'epf', detect: detectEpf, parse: parseEpf },
  { source: 'cas', detect: detectCas, parse: parseCas },
  { source: 'etrade-stmt', detect: detectEtradeStatement, parse: parseEtradeStatement },
];

export function detectSource(text: string): SourceId | null {
  let best: PdfSource | null = null;
  let bestScore = 0;
  for (const p of PDF_PARSERS) {
    const score = p.detect(text);
    if (score > bestScore) {
      best = p.source;
      bestScore = score;
    }
  }
  return best;
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);
const isPdf = (b: Uint8Array) => startsWith(b, [0x25, 0x50, 0x44, 0x46]); // %PDF
const isZip = (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]); // PK..

async function unlock(
  bytes: Uint8Array,
  opts: ParseOptions,
): Promise<{ lines: Line[]; passwordUsed?: string } | { status: 'password-required' | 'password-incorrect' }> {
  try {
    return { lines: await extractLines(bytes) };
  } catch (e) {
    if (!(e instanceof PdfPasswordError)) throw e;
  }
  if (!opts.password) return { status: 'password-required' };
  try {
    return { lines: await extractLines(bytes, opts.password), passwordUsed: opts.password };
  } catch (e) {
    if (!(e instanceof PdfPasswordError)) throw e;
    return { status: 'password-incorrect' };
  }
}

function parseMapped(bytes: Uint8Array, mapping: GenericMapping): ParseOutcome {
  const table = extractSpreadsheet(bytes);
  if (table === null) return { status: 'error', source: 'generic', message: 'Could not read this spreadsheet' };
  try {
    return { status: 'ok', result: parseGeneric(table, mapping) };
  } catch (e) {
    return { status: 'error', source: 'generic', message: (e as Error).message };
  }
}

function mappingOutcome(bytes: Uint8Array): ParseOutcome {
  const table = extractSpreadsheet(bytes);
  if (table === null) return { status: 'unknown', reason: 'Could not read this spreadsheet' };
  return { status: 'need-mapping', table };
}

export async function parseFile(bytes: Uint8Array, opts: ParseOptions = {}): Promise<ParseOutcome> {
  if (isPdf(bytes) && (opts.mapping !== undefined || opts.forceSource === 'generic')) {
    return {
      status: 'error',
      source: 'generic',
      message: 'CSV/Excel import cannot read a PDF. Export a spreadsheet from your bank, or pick the matching statement type.',
    };
  }
  if (opts.mapping) return parseMapped(bytes, opts.mapping);
  if (opts.forceSource === 'generic') return mappingOutcome(bytes);

  if (isZip(bytes)) {
    const wb = readWorkbook(bytes);
    if (opts.forceSource === 'etrade-xlsx' || detectBenefitHistory(wb)) {
      try {
        return { status: 'ok', result: parseBenefitHistory(wb) };
      } catch (e) {
        return { status: 'error', source: 'etrade-xlsx', message: (e as Error).message };
      }
    }
    return mappingOutcome(bytes);
  }
  if (!isPdf(bytes)) {
    if (looksLikeCsv(bytes)) return mappingOutcome(bytes);
    return { status: 'unknown', reason: 'File is neither a PDF, a spreadsheet, nor a CSV' };
  }

  const unlocked = await unlock(bytes, opts);
  if ('status' in unlocked) return unlocked;
  const source = opts.forceSource ?? detectSource(linesText(unlocked.lines));
  if (!source) return { status: 'unknown', reason: 'Could not recognise this statement' };
  const parser = PDF_PARSERS.find((p) => p.source === source);
  if (!parser) return { status: 'error', source, message: `${source} is not a PDF source` };
  try {
    return { status: 'ok', result: parser.parse(unlocked.lines), passwordUsed: unlocked.passwordUsed };
  } catch (e) {
    return { status: 'error', source, message: (e as Error).message };
  }
}
