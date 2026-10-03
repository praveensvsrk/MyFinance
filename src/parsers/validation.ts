import type { Check, Validation } from './types';

export function check(
  name: string,
  expected: number | string,
  actual: number | string,
  tolerance = 0,
): Check {
  const ok =
    typeof expected === 'number' && typeof actual === 'number'
      ? Math.abs(expected - actual) <= tolerance
      : expected === actual;
  return { name, expected, actual, ok };
}

export function validation(checks: Check[], notes: string[] = []): Validation {
  return { ok: checks.every((c) => c.ok), checks, notes };
}
