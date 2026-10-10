// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { RupeeInput } from '../../src/ui/common/RupeeInput';

afterEach(cleanup);

function Harness({ initial, seen }: { initial: string; seen: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <RupeeInput
      id="amt"
      aria-label="Amount"
      value={value}
      onChange={(next) => {
        seen.push(next);
        setValue(next);
      }}
    />
  );
}

describe('RupeeInput', () => {
  it('shows the value grouped and reports it without commas', () => {
    const seen: string[] = [];
    render(<Harness initial="5220484" seen={seen} />);
    const input = screen.getByLabelText('Amount') as HTMLInputElement;
    expect(input.value).toBe('52,20,484');

    fireEvent.change(input, { target: { value: '52,20,4840' } });
    expect(seen.at(-1)).toBe('5220484' + '0');
    expect(input.value).toBe('5,22,04,840');
  });

  it('keeps the caret after the same digit when commas move', () => {
    render(<Harness initial="99999" seen={[]} />);
    const input = screen.getByLabelText('Amount') as HTMLInputElement;
    // Typing a 1 at the very start of 99,999: the browser shows 199,999 with the caret after the 1.
    fireEvent.change(input, { target: { value: '199,999', selectionStart: 1, selectionEnd: 1 } });
    expect(input.value).toBe('1,99,999');
    expect(input.selectionStart).toBe(1);
  });

  it('uses a text field with the decimal keypad, not a number field', () => {
    render(<Harness initial="" seen={[]} />);
    const input = screen.getByLabelText('Amount') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');
  });
});
