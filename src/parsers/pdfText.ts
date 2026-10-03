import { getDocument, PasswordResponses } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface Cell {
  x: number;
  xe: number;
  s: string;
}

export interface Line {
  page: number;
  /** Distance from the top of the page, in points. */
  y: number;
  cells: Cell[];
  /** Cells joined with single spaces. */
  text: string;
}

export interface RawItem {
  x: number;
  y: number;
  w: number;
  s: string;
}

export class PdfPasswordError extends Error {
  constructor(readonly reason: 'required' | 'incorrect') {
    super(reason === 'required' ? 'PDF needs a password' : 'PDF password is incorrect');
    this.name = 'PdfPasswordError';
  }
}

const LINE_TOLERANCE = 2.5;
const MERGE_GAP = 4;

/**
 * Groups pdf.js text items into lines: items whose y differs by < 2.5pt share a line.
 * Within a line, items closer than 4pt are merged into one cell (pdf.js often returns word fragments).
 */
export function buildLines(items: RawItem[], page: number): Line[] {
  const sorted = items.filter((i) => i.s.trim() !== '').sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: { y: number; items: RawItem[] }[] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(it.y - g.y) < LINE_TOLERANCE) g.items.push(it);
    else groups.push({ y: it.y, items: [it] });
  }
  return groups.map((g) => {
    const cells: Cell[] = [];
    for (const it of g.items.sort((a, b) => a.x - b.x)) {
      const c = cells[cells.length - 1];
      const gap = c ? it.x - c.xe : Infinity;
      if (c && gap < MERGE_GAP) {
        c.s += (gap > 1 ? ' ' : '') + it.s;
        c.xe = Math.max(c.xe, it.x + it.w);
      } else {
        cells.push({ x: it.x, xe: it.x + it.w, s: it.s });
      }
    }
    for (const c of cells) c.s = c.s.replace(/\s+/g, ' ').trim();
    return { page, y: g.y, cells, text: cells.map((c) => c.s).join(' ') };
  });
}

/** Extracts all text lines from a PDF. Throws PdfPasswordError when a password is missing or wrong. */
export async function extractLines(data: Uint8Array, password?: string): Promise<Line[]> {
  // pdf.js detaches the buffer it is given, so pass a copy.
  const task = getDocument({ data: data.slice(), password, verbosity: 0, isEvalSupported: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err?.name === 'PasswordException') {
      throw new PdfPasswordError(err.code === PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'required');
    }
    throw e;
  }
  try {
    const lines: Line[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const height = page.view[3];
      const content = await page.getTextContent();
      const items: RawItem[] = [];
      for (const i of content.items) {
        if (!('str' in i)) continue;
        items.push({ x: i.transform[4], y: height - i.transform[5], w: i.width, s: i.str });
      }
      lines.push(...buildLines(items, p));
    }
    return lines;
  } finally {
    await doc.destroy();
  }
}

export function linesText(lines: Line[]): string {
  return lines.map((l) => l.text).join('\n');
}

/** Picks the column whose right edge is closest to `xe`. */
export function nearestColumn<K extends string>(xe: number, columns: Record<K, number>): K {
  let best: K | undefined;
  let dist = Infinity;
  for (const k of Object.keys(columns) as K[]) {
    const d = Math.abs(columns[k] - xe);
    if (d < dist) {
      dist = d;
      best = k;
    }
  }
  if (best === undefined) throw new Error('nearestColumn: no columns');
  return best;
}
