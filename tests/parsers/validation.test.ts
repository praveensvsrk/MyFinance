import { describe, expect, it } from 'vitest';
import { check, validation } from '../../src/parsers/validation';

describe('validation helpers', () => {
  it('passes equal numbers and fails different ones', () => {
    expect(check('a', 100, 100).ok).toBe(true);
    expect(check('a', 100, 101).ok).toBe(false);
  });

  it('honours a tolerance', () => {
    expect(check('a', 100, 104, 4).ok).toBe(true);
    expect(check('a', 100, 105, 4).ok).toBe(false);
  });

  it('compares strings exactly', () => {
    expect(check('s', 'yes', 'yes').ok).toBe(true);
    expect(check('s', 'yes', 'no').ok).toBe(false);
  });

  it('is ok only when every check is ok', () => {
    expect(validation([check('a', 1, 1)]).ok).toBe(true);
    expect(validation([check('a', 1, 1), check('b', 1, 2)]).ok).toBe(false);
    expect(validation([], ['note']).notes).toEqual(['note']);
  });
});
