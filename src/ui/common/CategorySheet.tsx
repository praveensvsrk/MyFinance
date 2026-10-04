import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { TxnRow } from '../../db/schema';
import { categoryChoices } from '../../domain/categorise';
import { rulePatternFor } from '../../services/actions/rules';
import { useActions } from '../actions';
import { useCategoryConfig, useRules } from '../hooks';
import { Icon } from '../Icon';
import { Sheet } from './Sheet';
import { merchantOf } from './TxnItem';

/** Re-files one transaction, optionally saving a rule so similar narrations follow. */
export function CategorySheet({ txn, onClose }: { txn: TxnRow; onClose: () => void }) {
  const actions = useActions();
  const [category, setCategory] = useState(txn.category ?? '');
  const [applyToAll, setApplyToAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const config = useCategoryConfig();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pattern = rulePatternFor(txn.description);
  const choices = categoryChoices(useRules().data ?? [], config.custom);

  /** New categories are made in Settings; it sends you back here when you are done. */
  function newCategory() {
    navigate('/settings', { state: { newCategory: true, returnTo: pathname } });
  }

  async function save() {
    if (category === '') return;
    setBusy(true);
    try {
      await actions.recategorise(txn.id, category, { applyToAll: applyToAll && pattern !== null });
    } finally {
      onClose();
    }
  }

  return (
    <Sheet title="Change category" subtitle={merchantOf(txn.description)} onClose={onClose}>
      <div className="chips" role="radiogroup" aria-label="Category" style={{ margin: '16px 0' }}>
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
        <label className="check">
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
        className={category === '' || busy ? 'btn block dis' : 'btn block fill'}
        style={{ marginTop: 16 }}
        disabled={category === '' || busy}
        onClick={() => void save()}
      >
        Save
      </button>
    </Sheet>
  );
}
