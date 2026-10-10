import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { TxnRow } from '../../db/schema';
import { categoryChoices } from '../../domain/categorise';
import { rulePatternFor } from '../../services/actions/rules';
import { useActions } from '../actions';
import { dateLong } from '../format';
import { useAccounts, useCategoryConfig, useRules } from '../hooks';
import { Icon } from '../Icon';
import { Money } from '../Money';
import { Sheet } from './Sheet';
import { merchantOf } from './TxnItem';

/** Where Cash flow reads a search to run when "Show all from this payee" opens it. */
export interface CashFlowState {
  search?: string;
}

/**
 * One transaction in full: narration, reference and balance after, its category with the option
 * to file similar narrations the same way, and a jump to every transaction with the same payee.
 */
export function TxnSheet({ txn, onClose }: { txn: TxnRow; onClose: () => void }) {
  const actions = useActions();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const account = useAccounts().data?.find((row) => row.id === txn.accountId);
  const config = useCategoryConfig();
  const choices = categoryChoices(useRules().data ?? [], config.custom);
  const [category, setCategory] = useState(txn.category ?? '');
  const [applyToAll, setApplyToAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const merchant = merchantOf(txn.description);
  const pattern = rulePatternFor(txn.description);
  const notSpending = txn.kind === 'transfer' || txn.kind === 'investment';
  const canSave = category !== '' && (category !== txn.category || applyToAll) && !busy;

  /** New categories are made in Settings; it sends you back here when you are done. */
  function newCategory() {
    navigate('/settings', { state: { newCategory: true, returnTo: pathname } });
  }

  function showPayee() {
    onClose();
    navigate('/cash-flow', { state: { search: merchant } satisfies CashFlowState });
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      await actions.recategorise(txn.id, category, { applyToAll: applyToAll && pattern !== null });
    } finally {
      onClose();
    }
  }

  return (
    <Sheet
      title={merchant}
      subtitle={account === undefined ? dateLong(txn.date) : `${dateLong(txn.date)} · ${account.name}`}
      onClose={onClose}
      testId="txn-sheet"
    >
      <div className={txn.amount > 0 ? 'ts-amt in' : 'ts-amt'}>
        <Money paise={txn.amount} sign />
      </div>
      <p className="ts-narr">{txn.description}</p>
      <div>
        {txn.ref !== '' && (
          <div className="kv">
            <span className="k">Reference</span>
            <span className="v ts-ref">{txn.ref}</span>
          </div>
        )}
        <div className="kv">
          <span className="k">Balance after</span>
          <span className="v">
            <Money paise={txn.balanceAfter} />
          </span>
        </div>
      </div>

      {notSpending ? (
        <p className="muted ts-note">
          {txn.kind === 'transfer'
            ? 'A move between your own accounts, so it is not counted as spending.'
            : 'Money put into an investment, so it is not counted as spending.'}
        </p>
      ) : (
        <>
          <h3 className="ts-h" id="ts-cat">
            Category
          </h3>
          <div className="chips" role="radiogroup" aria-labelledby="ts-cat">
            {choices.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={name === category}
                className={name === category ? 'chip on' : 'chip'}
                onClick={() => setCategory(name)}
              >
                {name}
                {config.excluded.includes(name) && <span className="hint">not spending</span>}
              </button>
            ))}
            <button type="button" className="chip" onClick={newCategory}>
              <Icon name="plus" size={16} /> New category
            </button>
          </div>
          {pattern !== null && (
            <label className="check" style={{ marginTop: 16 }}>
              <input type="checkbox" checked={applyToAll} onChange={(event) => setApplyToAll(event.target.checked)} />
              <span>
                Also file other “{pattern}” transactions here
                <span className="hint" style={{ display: 'block' }}>
                  Saves a rule. Anything you categorised by hand stays as it is.
                </span>
              </span>
            </label>
          )}
          <button
            type="button"
            className={canSave ? 'btn block fill' : 'btn block dis'}
            style={{ marginTop: 16 }}
            disabled={!canSave}
            onClick={() => void save()}
          >
            Save category
          </button>
        </>
      )}
      <button type="button" className="btn block out" style={{ marginTop: 12 }} onClick={showPayee}>
        <Icon name="search" size={18} /> Show all from {merchant}
      </button>
    </Sheet>
  );
}
