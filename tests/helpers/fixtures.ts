import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLines, type Line } from '../../src/parsers/pdfText';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures');

/** True when fixtures/<rel> exists. Real statements are git-ignored, so tests must skip without them. */
export function hasFixture(rel: string): boolean {
  return existsSync(path.join(FIXTURES, rel));
}

export function readFixture(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, rel)));
}

/** Password for fixtures/<rel> from the git-ignored fixtures/passwords.json. Never log it. */
export function fixturePassword(rel: string): string | undefined {
  const file = path.join(FIXTURES, 'passwords.json');
  if (!existsSync(file)) return undefined;
  const map = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  return map[rel];
}

/** Text lines of a fixture PDF, unlocked with its saved password if it has one. */
export function fixtureLines(rel: string): Promise<Line[]> {
  return extractLines(readFixture(rel), fixturePassword(rel));
}
