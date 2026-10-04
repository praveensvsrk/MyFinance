import type { ParsedFile, SourceId } from './types';
import { extractLines, linesText, PdfPasswordError, type Line } from './pdfText';
import { detectSbi, parseSbi } from './sbi';
import { detectFederal, parseFederal } from './federal';
import { detectUbiSavings, parseUbiSavings } from './ubiSavings';
import { detectUbiLoan, parseUbiLoan } from './ubiLoan';
import { detectUbiCertificate, parseUbiCertificate } from './ubiCertificate';
import { detectEpf, parseEpf } from './epf';
import { detectCas, parseCas } from './cas';
import { detectEtradeStatement, parseEtradeStatement } from './etradeStatement';
import { detectBenefitHistory, parseBenefitHistory, readWorkbook } from './benefitHistory';

export * from './types';

export interface ParseOptions {
  /** Password typed by the user for this file. */
  password?: string;
  /** Skip detection and use this source (user picked it manually). */
  forceSource?: SourceId;
}

export type ParseOutcome =
  | { status: 'ok'; result: ParsedFile; passwordUsed?: string }
  | { status: 'password-required' }
  | { status: 'password-incorrect' }
  | { status: 'unknown'; reason: string }
  | { status: 'error'; source: SourceId; message: string };

type PdfSource = Exclude<SourceId, 'etrade-xlsx'>;

// Order matters only for ties: more specific sources first.
export const PDF_PARSERS: { source: PdfSource; detect: (text: string) => number; parse: (lines: Line[]) => ParsedFile }[] = [
  { source: 'ubi-cert', detect: detectUbiCertificate, parse: parseUbiCertificate },
  { source: 'ubi-loan', detect: detectUbiLoan, parse: parseUbiLoan },
  { source: 'ubi-savings', detect: detectUbiSavings, parse: parseUbiSavings },
  { source: 'sbi', detect: detectSbi, parse: parseSbi },
  { source: 'federal', detect: detectFederal, parse: parseFederal },
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

export async function parseFile(bytes: Uint8Array, opts: ParseOptions = {}): Promise<ParseOutcome> {
  if (isZip(bytes)) {
    const wb = readWorkbook(bytes);
    if (opts.forceSource !== 'etrade-xlsx' && !detectBenefitHistory(wb)) {
      return { status: 'unknown', reason: 'Spreadsheet is not an E*TRADE Benefit History export' };
    }
    try {
      return { status: 'ok', result: parseBenefitHistory(wb) };
    } catch (e) {
      return { status: 'error', source: 'etrade-xlsx', message: (e as Error).message };
    }
  }
  if (!isPdf(bytes)) return { status: 'unknown', reason: 'File is neither a PDF nor an XLSX' };

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
