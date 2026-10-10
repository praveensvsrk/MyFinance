import { useState } from 'react';
import type { GoalRow } from '../../db/schema';
import type { Paise } from '../../parsers/types';
import { goalProgress } from '../../services/actions/goals';
import type { AccountListItem } from '../../services/accounts';
import { useApp } from '../AppContext';
import { useActions } from '../actions';
import { isRealDate, parseRupees, rupeesText } from '../common/amount';
import { Field } from '../common/Field';
import { Sheet } from '../common/Sheet';
import { dateLong } from '../format';
import { Icon } from '../Icon';
import { Money } from '../Money';

const RING_COLORS = ['var(--good)', 'var(--asset-retirement)', 'var(--asset-property)', 'var(--asset-liquid)'];

function GoalSheet({
  goal,
  accounts,
  onClose,
}: {
  goal: GoalRow | null;
  accounts: AccountListItem[];
  onClose: () => void;
}) {
  const { today } = useApp();
  const actions = useActions();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal === null ? '' : rupeesText(goal.targetPaise));
  const [date, setDate] = useState(goal?.targetDate ?? '');
  const [linked, setLinked] = useState<string[]>(goal?.linkedAccountIds ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const targetPaise = parseRupees(target);
  const valid = name.trim() !== '' && targetPaise !== null && targetPaise > 0 && isRealDate(date) && date > today;

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    try {
      await task();
    } finally {
      onClose();
    }
  }

  return (
    <Sheet title={goal === null ? 'New goal' : 'Edit goal'} onClose={onClose}>
      <form
        className="stack gap16"
        style={{ marginTop: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          void run(() =>
            actions.saveGoal({
              ...(goal === null ? {} : { id: goal.id }),
              name: name.trim(),
              targetPaise: targetPaise,
              targetDate: date,
              linkedAccountIds: linked,
            }),
          );
        }}
      >
        <Field id="goal-name" label="Goal" value={name} onChange={setName} placeholder="House down payment" />
        <Field
          id="goal-target"
          label="Target amount"
          prefix="₹"
          rupees
          value={target}
          onChange={setTarget}
          error={target !== '' && targetPaise === null ? 'Enter an amount in rupees, like 2500000' : undefined}
        />
        <div className="field">
          <label htmlFor="goal-date">Target date</label>
          <div className="inp">
            <input id="goal-date" type="date" min={today} value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
        </div>
        <fieldset className="field">
          <legend className="fl" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            Counts towards this goal
          </legend>
          {accounts.map((account) => (
            <label key={account.id} className="check">
              <input
                type="checkbox"
                checked={linked.includes(account.id)}
                onChange={(event) =>
                  setLinked((ids) => (event.target.checked ? [...ids, account.id] : ids.filter((id) => id !== account.id)))
                }
              />
              {account.name}
            </label>
          ))}
        </fieldset>
        <button type="submit" className={valid && !busy ? 'btn block fill' : 'btn block dis'} disabled={!valid || busy}>
          Save goal
        </button>
        {goal !== null &&
          (confirmDelete ? (
            <button
              type="button"
              className="btn block danger"
              disabled={busy}
              onClick={() => void run(() => actions.deleteGoal(goal.id))}
            >
              Yes, delete this goal
            </button>
          ) : (
            <button type="button" className="btn block text" style={{ color: 'var(--bad)' }} onClick={() => setConfirmDelete(true)}>
              Delete goal
            </button>
          ))}
      </form>
    </Sheet>
  );
}

/** Savings goals with progress from the linked accounts and the monthly saving each still needs. */
export function GoalsSection({
  goals,
  balances,
  accounts,
}: {
  goals: GoalRow[];
  balances: Record<string, Paise>;
  accounts: AccountListItem[];
}) {
  const { today } = useApp();
  const [editing, setEditing] = useState<GoalRow | 'new' | null>(null);
  const linkable = accounts.filter((account) => account.kind !== 'loan');

  return (
    <section className="stack gap12" aria-labelledby="goals-h">
      <div className="sec">
        <h2 id="goals-h">Goals</h2>
        <button type="button" className="link" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} />
          Add goal
        </button>
      </div>
      {goals.length === 0 ? (
        <div className="card tonal">
          <p>Set a target and a date to see the monthly saving.</p>
        </div>
      ) : (
        <ul className="card goal-list">
          {goals.map((goal, i) => {
            const progress = goalProgress(goal, balances, today);
            const pctText = `${Math.round(progress.pct)}%`;
            const r = 23;
            const circ = 2 * Math.PI * r;
            const dash = (Math.min(100, Math.max(0, progress.pct)) / 100) * circ;
            return (
              <li key={goal.id} className="goal">
                <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${pctText} funded`} style={{ flex: 'none' }}>
                  <circle cx="28" cy="28" r={r} fill="none" stroke="var(--line-soft)" strokeWidth="6" />
                  <circle
                    cx="28"
                    cy="28"
                    r={r}
                    fill="none"
                    stroke={RING_COLORS[i % RING_COLORS.length]}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${circ}`}
                    transform="rotate(-90 28 28)"
                  />
                  <text x="28" y="32" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="13" fontWeight="600" fill="currentColor">
                    {pctText}
                  </text>
                </svg>
                <span className="goal-mid">
                  <h3 className="goal-ttl">{goal.name}</h3>
                  <span className="mono goal-sub">
                    <Money paise={progress.current} compact /> of <Money paise={goal.targetPaise} compact /> · {dateLong(goal.targetDate)}
                  </span>
                  <span className="goal-chip">
                    {progress.monthlyRequired === 0 ? (
                      'Target reached'
                    ) : (
                      <>
                        <Money paise={progress.monthlyRequired} whole /> a month to get there
                      </>
                    )}
                  </span>
                </span>
                <button type="button" className="ib plain" aria-label={`Edit ${goal.name}`} onClick={() => setEditing(goal)}>
                  <Icon name="edit" size={20} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {editing !== null && (
        <GoalSheet goal={editing === 'new' ? null : editing} accounts={linkable} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
