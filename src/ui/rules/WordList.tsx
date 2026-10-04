import { useId, type KeyboardEvent } from 'react';
import { Icon } from '../Icon';

/**
 * A list of words kept as removable chips, with a box to type the next one. The text in the box is
 * the caller's (`pending`), so a word typed but not yet added still counts in a live preview.
 */
export function WordList({
  label,
  hint,
  words,
  pending,
  onWords,
  onPending,
  placeholder,
}: {
  label: string;
  hint?: string;
  words: string[];
  pending: string;
  onWords: (words: string[]) => void;
  onPending: (text: string) => void;
  placeholder?: string;
}) {
  const id = useId();

  function add() {
    const word = pending.trim();
    if (word === '') return;
    if (!words.some((existing) => existing.toUpperCase() === word.toUpperCase())) onWords([...words, word]);
    onPending('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {words.length > 0 && (
        <ul className="chips" aria-label={`${label}: added`}>
          {words.map((word) => (
            <li key={word} className="chip on">
              {word}
              <button
                type="button"
                className="chip-x"
                aria-label={`Remove ${word}`}
                onClick={() => onWords(words.filter((existing) => existing !== word))}
              >
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="inp">
        <input
          id={id}
          type="text"
          autoComplete="off"
          placeholder={placeholder}
          value={pending}
          onChange={(event) => onPending(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="link" onClick={add} disabled={pending.trim() === ''}>
          Add
        </button>
      </div>
      {hint !== undefined && <span className="hint">{hint}</span>}
    </div>
  );
}
