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
          inputMode="decimal"
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
          <p>Set a target and a date. The app works out how much to put aside each month.</p>
        </div>
      ) : (
        goals.map((goal) => {
          const progress = goalProgress(goal, balances, today);
          return (
            <div key={goal.id} className="card">
              <div className="row-between">
                <h3 className="t-title">{goal.name}</h3>
                <span className="row-between" style={{ gap: 4 }}>
                  <span className="tag">{Math.round(progress.pct)}%</span>
                  <button type="button" className="ib sm" aria-label={`Edit ${goal.name}`} onClick={() => setEditing(goal)}>
                    <Icon name="edit" size={20} />
                  </button>
                </span>
              </div>
              <div className="prog" role="img" aria-label={`${Math.round(progress.pct)}% of the target`} style={{ margin: '10px 0 6px' }}>
                <i className={progress.pct >= 100 ? 'good' : ''} style={{ width: `${progress.pct}%` }} />
              </div>
              <span className="sub">
                <Money paise={progress.current} compact /> of <Money paise={goal.targetPaise} compact /> by{' '}
                {dateLong(goal.targetDate)}
              </span>
              <div className="note" style={{ marginTop: 10 }}>
                {progress.monthlyRequired === 0 ? (
                  <span>Target reached.</span>
                ) : (
                  <span>
                    Put aside <b><Money paise={progress.monthlyRequired} whole /></b> a month to get there.
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
      {editing !== null && (
        <GoalSheet goal={editing === 'new' ? null : editing} accounts={linkable} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
