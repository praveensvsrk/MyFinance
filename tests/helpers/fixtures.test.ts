import { describe, expect, it } from 'vitest';
import { fixturePassword, hasFixture, readFixture } from './fixtures';

const FEDERAL = 'federal/savings.pdf';

describe('fixture helper', () => {
  it('reports a missing fixture', () => {
    expect(hasFixture('nope/missing.pdf')).toBe(false);
  });

  it('has no password for an unknown fixture', () => {
    expect(fixturePassword('nope/missing.pdf')).toBeUndefined();
  });

  it.skipIf(!hasFixture(FEDERAL))('reads fixture bytes', () => {
    const bytes = readFixture(FEDERAL);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');
  });
});
