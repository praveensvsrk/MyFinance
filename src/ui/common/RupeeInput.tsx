import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
import { groupRupees } from './amount';

type Passed = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'>;

/**
 * A rupee amount field that groups digits the Indian way as you type (`52,20,484`), so a missing or
 * extra zero is easy to spot. `value` and `onChange` use the plain text without commas, which
 * `parseRupees` and `Number` read as before.
 */
export function RupeeInput({ value, onChange, ...rest }: Passed & { value: string; onChange: (plain: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  /** Characters before the caret, commas not counted, to restore after regrouping. */
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = ref.current;
    if (caret.current === null || input === null) return;
    let pos = 0;
    for (let seen = 0; pos < input.value.length && seen < caret.current; pos += 1) {
      if (input.value[pos] !== ',') seen += 1;
    }
    input.setSelectionRange(pos, pos);
    caret.current = null;
  });

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...rest}
      value={groupRupees(value)}
      onChange={(event) => {
        const input = event.target;
        const before = input.value.slice(0, input.selectionStart ?? input.value.length);
        caret.current = before.replace(/,/g, '').length;
        onChange(input.value.replace(/,/g, ''));
      }}
    />
  );
}
