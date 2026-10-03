import type { HTMLInputTypeAttribute } from 'react';

/** A labelled text input in the design's field style, with an optional prefix, suffix, hint and error. */
export function Field({
  id,
  label,
  value,
  onChange,
  prefix,
  suffix,
  hint,
  error,
  type = 'text',
  inputMode,
  autoComplete = 'off',
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  error?: string;
  type?: HTMLInputTypeAttribute;
  inputMode?: 'decimal' | 'numeric' | 'text';
  autoComplete?: string;
  placeholder?: string;
}) {
  const describedBy = error !== undefined ? `${id}-err` : hint !== undefined ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={error === undefined ? 'inp' : 'inp err'}>
        {prefix !== undefined && <span className="pre">{prefix}</span>}
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix !== undefined && <span className="pre">{suffix}</span>}
      </div>
      {error !== undefined ? (
        <span id={`${id}-err`} className="hint err">
          {error}
        </span>
      ) : hint !== undefined ? (
        <span id={`${id}-hint`} className="hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
