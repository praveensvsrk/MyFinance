import { useMemo, useState } from 'react';
import type { RuleRow, TxnRow } from '../../db/schema';
import { categoryChoices, previewRule, type RuleDirection } from '../../domain/categorise';
import { cleanWords, draftFromRule, ruleFromDraft, validateDraft, type RuleDraft } from '../../domain/ruleDraft';
import { useActions } from '../actions';
import { parseRupees, rupeesText } from '../common/amount';
import { Field } from '../common/Field';
import { merchantOf } from '../common/TxnItem';
import { dateShort } from '../format';
import { useAccounts, useAllTransactions, useCategoryConfig, useRules } from '../hooks';
import { Money } from '../Money';
import { WordList } from './WordList';

const PREVIEW_ROWS = 20;

const COUNTS = [
  { value: 'spending', kind: 'normal', label: 'Spending', hint: 'Counted in spending and income.' },
  { value: 'notSpending', kind: 'excluded', label: 'Not spending', hint: 'Left out of Spent and Saved.' },
  {
    value: 'investment',
    kind: 'investment',
    label: 'Investment',
    hint: 'Left out of Spent and Saved, and matched with your mutual fund statements.',
  },
] as const;

type Counts = (typeof COUNTS)[number]['value'];

/** Radio for a saved kind, or Not spending when a new rule targets a Settings-excluded category. */
function countsAsOf(kind: RuleDraft['kind'] | undefined, categoryExcluded: boolean): Counts {
  const match = COUNTS.find((option) => option.kind === kind);
  if (match !== undefined) return match.value;
  return categoryExcluded ? 'notSpending' : 'spending';
}

const DIRECTIONS: { value: RuleDirection | 'any'; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'debit', label: 'Debit' },
  { value: 'credit', label: 'Credit' },
];

/** Blank text is "not set"; anything else must be a rupee amount. */
function boundOf(text: string): { paise?: number; error?: string } {
  if (text.trim() === '') return {};
  const paise = parseRupees(text);
  return paise === null ? { error: 'Enter an amount like 5000.' } : { paise };
}

function PreviewRow({ txn, to }: { txn: TxnRow; to: string }) {
  return (
    <li className="txn">
      <div className="mid">
        <span className="mer">{merchantOf(txn.description)}</span>
        <span className="narr">
          {dateShort(txn.date)} · {txn.description}
        </span>
        <span className="meta">
          <span className="tag">{txn.category ?? 'Uncategorised'}</span>
          <span aria-hidden="true">→</span>
          <span className="sr">becomes</span>
          <span className="tag acc">{to}</span>
        </span>
      </div>
      <div className="end">
        <span className={txn.amount > 0 ? 'amt in' : 'amt'}>
          <Money paise={txn.amount} sign />
        </span>
      </div>
    </li>
  );
}

/**
 * Builds or edits one rule, Outlook-style: pick the conditions, any exceptions and what to do, and
 * watch the transactions it would re-file update as you type. Nothing is saved until Save.
 */
export function RuleEditor({ rule, onDone }: { rule: RuleRow | null; onDone: () => void }) {
  const actions = useActions();
  const rules = useRules().data ?? [];
  const config = useCategoryConfig();
  const accounts = (useAccounts().data ?? []).filter((account) => account.kind === 'savings' || account.kind === 'card');
  const txns = useAllTransactions().data ?? [];

  const initial = useMemo(() => (rule === null ? null : draftFromRule(rule)), [rule]);
  const [name, setName] = useState(initial?.name ?? '');
  const [words, setWords] = useState(initial?.words ?? []);
  const [pendingWord, setPendingWord] = useState('');
  const [isRegex, setIsRegex] = useState(initial?.isRegex ?? false);
  const [exceptWords, setExceptWords] = useState(initial?.exceptWords ?? []);
  const [pendingExcept, setPendingExcept] = useState('');
  const [direction, setDirection] = useState<RuleDirection | 'any'>(initial?.direction ?? 'any');
  const [minText, setMinText] = useState(initial?.minAmount === undefined ? '' : rupeesText(initial.minAmount));
  const [maxText, setMaxText] = useState(initial?.maxAmount === undefined ? '' : rupeesText(initial.maxAmount));
  const [accountId, setAccountId] = useState(initial?.accountId ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [picked, setPicked] = useState<Counts | null>(null);
  const [apply, setApply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const categoryExcluded = config.excluded.some((name) => name.toLowerCase() === category.trim().toLowerCase());
  const counts = picked ?? countsAsOf(initial?.kind, categoryExcluded);
  const selected = COUNTS.find((option) => option.value === counts) ?? COUNTS[0];

  const min = boundOf(minText);
  const max = boundOf(maxText);
  const amountError = min.error ?? max.error;
  const draft: RuleDraft = {
    id: rule?.id,
    name,
    words: cleanWords([...words, pendingWord]),
    isRegex,
    exceptWords: cleanWords([...exceptWords, pendingExcept]),
    direction: direction === 'any' ? undefined : direction,
    minAmount: min.paise,
    maxAmount: max.paise,
    accountId: accountId === '' ? undefined : accountId,
    category,
    kind: selected.kind,
  };
  const problem = amountError ?? validateDraft(draft);
  const hasCondition = amountError === undefined && validateDraft({ ...draft, category: draft.category || '…' }) === null;

  const topPriority = rules.reduce((highest, row) => Math.max(highest, row.priority), 0) + 10;
  const previewed = ruleFromDraft(
    { ...draft, category: draft.category.trim() || '…' },
    rule?.id ?? 'draft',
    rule?.priority ?? topPriority,
  );
  const preview = useMemo(
    () => (hasCondition ? previewRule(txns, previewed, rules) : null),
    // `previewed` is rebuilt each render; its JSON is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasCondition, txns, rules, JSON.stringify(previewed)],
  );

  const target = category.trim() === '' ? 'a category' : category.trim();

  async function save() {
    setBusy(true);
    setFailure(null);
    try {
      await actions.saveRule(draft, { applyToExisting: apply });
      onDone();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not save the rule.');
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 20, marginTop: 16 }}>
      <Field
        id="rule-name"
        label="Rule name (optional)"
        value={name}
        onChange={setName}
        placeholder={words[0] ?? 'e.g. Mutual fund SIPs'}
      />

      <section className="stack" style={{ gap: 16 }} aria-label="When a transaction">
        <h3 className="t-title">When a transaction…</h3>
        <WordList
          label="Narration contains any of"
          words={words}
          pending={pendingWord}
          onWords={setWords}
          onPending={setPendingWord}
          placeholder="e.g. INDIAN CLEARING"
          hint="Press Enter or Add. Capital letters and extra spaces don’t matter."
        />
        <label className="check">
          <input type="checkbox" checked={isRegex} onChange={(event) => setIsRegex(event.target.checked)} />
          <span>
            Words are patterns (regex)
            <span className="hint" style={{ display: 'block' }}>
              For advanced matching, such as ^UPI.*SWIGGY.
            </span>
          </span>
        </label>

        <div className="field">
          <span className="fl" id="dir-label">
            Money goes
          </span>
          <div className="seg block" role="radiogroup" aria-labelledby="dir-label">
            {DIRECTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={direction === option.value}
                className={direction === option.value ? 'on' : undefined}
                onClick={() => setDirection(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
          <Field id="rule-min" label="Amount at least" prefix="₹" inputMode="decimal" value={minText} onChange={setMinText} error={min.error} />
          <Field id="rule-max" label="Amount at most" prefix="₹" inputMode="decimal" value={maxText} onChange={setMaxText} error={max.error} />
        </div>

        {accounts.length > 1 && (
          <div className="field">
            <label htmlFor="rule-account">In account</label>
            <div className="inp">
              <select id="rule-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">Any account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} {account.maskedNumber}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <WordList
          label="Except if the narration contains"
          words={exceptWords}
          pending={pendingExcept}
          onWords={setExceptWords}
          onPending={setPendingExcept}
          placeholder="e.g. REFUND"
        />
      </section>

      <section className="stack" style={{ gap: 16 }} aria-label="Then">
        <h3 className="t-title">Then…</h3>
        <Field
          id="rule-category"
          label="File it under"
          value={category}
          onChange={setCategory}
          placeholder="Pick one or type a new category"
        />
        <div className="chips" role="group" aria-label="Categories">
          {categoryChoices(rules, config.custom).map((choice) => {
            const on = choice.toUpperCase() === category.trim().toUpperCase();
            return (
              <button
                key={choice}
                type="button"
                className={on ? 'chip on' : 'chip'}
                aria-pressed={on}
                onClick={() => setCategory(choice)}
              >
                {choice}
              </button>
            );
          })}
        </div>
        <div className="field">
          <span className="fl" id="kind-label">
            Counts as
          </span>
          <div className="seg block" role="radiogroup" aria-labelledby="kind-label">
            {COUNTS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={counts === option.value}
                className={counts === option.value ? 'on' : undefined}
                onClick={() => setPicked(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="hint">{selected.hint}</span>
        </div>
      </section>

      <section aria-label="Preview" aria-live="polite" data-testid="rule-preview">
        <h3 className="t-title">Preview</h3>
        {preview === null ? (
          <p className="muted">Add a word, an amount or an account to see which transactions this rule would change.</p>
        ) : (
          <>
            <p>
              <b>{preview.changes.length}</b> {preview.changes.length === 1 ? 'transaction' : 'transactions'} would move to {target}
              {preview.alreadyCorrect > 0 && ` · ${preview.alreadyCorrect} already there`}
              {preview.keptManual > 0 && ` · ${preview.keptManual} kept because you set them by hand`}
              {preview.shadowed > 0 && ` · ${preview.shadowed} left to a rule above`}
            </p>
            {preview.changes.length > 0 && (
              <div className="card flat" style={{ marginTop: 8 }}>
                <ul>
                  {preview.changes.slice(0, PREVIEW_ROWS).map((txn) => (
                    <PreviewRow key={txn.id} txn={txn} to={target} />
                  ))}
                </ul>
              </div>
            )}
            {preview.changes.length > PREVIEW_ROWS && (
              <span className="cap">…and {preview.changes.length - PREVIEW_ROWS} more.</span>
            )}
          </>
        )}
      </section>

      <label className="check">
        <input type="checkbox" checked={apply} onChange={(event) => setApply(event.target.checked)} />
        <span>
          Also apply to existing transactions
          <span className="hint" style={{ display: 'block' }}>
            Future imports follow the rule either way.
          </span>
        </span>
      </label>

      {failure !== null && (
        <p role="alert" className="hint err">
          {failure}
        </p>
      )}
      <div className="row-between">
        <button type="button" className="btn out" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className={problem !== null || busy ? 'btn fill dis' : 'btn fill'}
          disabled={problem !== null || busy}
          onClick={() => void save()}
        >
          Save rule
        </button>
      </div>
    </div>
  );
}
