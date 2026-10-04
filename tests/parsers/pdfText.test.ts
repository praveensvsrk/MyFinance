import { describe, expect, it } from 'vitest';
import { buildLines, extractLines, linesText, nearestColumn, PdfPasswordError } from '../../src/parsers/pdfText';
import { fixturePassword, hasFixture, readFixture } from '../helpers/fixtures';

describe('buildLines', () => {
  it('groups items by y and merges items closer than 4pt', () => {
    const lines = buildLines(
      [
        { x: 10, y: 100, w: 20, s: 'Hello' },
        { x: 32, y: 100.5, w: 20, s: 'World' },
        { x: 100, y: 101, w: 30, s: '1,234.00' },
        { x: 10, y: 110, w: 20, s: 'Next' },
      ],
      1,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].cells.map((c) => c.s)).toEqual(['Hello World', '1,234.00']);
    expect(lines[0].cells[1]).toMatchObject({ x: 100, xe: 130 });
    expect(lines[0].text).toBe('Hello World 1,234.00');
    expect(lines[1]).toMatchObject({ page: 1, y: 110, text: 'Next' });
  });

  it('joins touching fragments without a space and drops blank items', () => {
    const lines = buildLines(
      [
        { x: 10, y: 5, w: 10, s: 'IN' },
        { x: 20.5, y: 5, w: 10, s: 'R' },
        { x: 50, y: 5, w: 5, s: '  ' },
      ],
      2,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('INR');
  });

  it('sorts lines top to bottom and cells left to right', () => {
    const lines = buildLines(
      [
        { x: 200, y: 50, w: 10, s: 'B' },
        { x: 10, y: 50, w: 10, s: 'A' },
        { x: 10, y: 20, w: 10, s: 'Top' },
      ],
      1,
    );
    expect(lines.map((l) => l.text)).toEqual(['Top', 'A B']);
  });
});

describe('nearestColumn', () => {
  it('picks the closest right edge', () => {
    const cols = { withdrawal: 461, deposit: 504, balance: 544 };
    expect(nearestColumn(460, cols)).toBe('withdrawal');
    expect(nearestColumn(505, cols)).toBe('deposit');
    expect(nearestColumn(560, cols)).toBe('balance');
  });
});

const FEDERAL = 'federal/savings.pdf';
const SBI = 'sbi/savings.pdf';

describe.skipIf(!hasFixture(FEDERAL))('extractLines on a real statement', () => {
  it('reads every page in order', async () => {
    const lines = await extractLines(readFixture(FEDERAL));
    expect(lines[0].page).toBe(1);
    expect(lines[lines.length - 1].page).toBe(11);
    expect(linesText(lines)).toContain('Statement of Account for the period');
  });
});

describe.skipIf(!hasFixture(SBI))('extractLines on a password-protected statement', () => {
  it('signals a missing password', async () => {
    await expect(extractLines(readFixture(SBI))).rejects.toMatchObject({ name: 'PdfPasswordError', reason: 'required' });
  });

  it('signals a wrong password', async () => {
    await expect(extractLines(readFixture(SBI), 'definitely-wrong')).rejects.toBeInstanceOf(PdfPasswordError);
    await expect(extractLines(readFixture(SBI), 'definitely-wrong')).rejects.toMatchObject({ reason: 'incorrect' });
  });

  it('opens with the saved password', async () => {
    const lines = await extractLines(readFixture(SBI), fixturePassword(SBI));
    expect(linesText(lines)).toContain('Statement Summary');
  });
});
