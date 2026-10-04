import { useState } from 'react';
import type { TxnRow } from '../../db/schema';
import { allCategories } from '../../domain/categories';
import { rulePatternFor } from '../../services/actions/rules';
import { useActions } from '../actions';
import { useCategoryConfig } from '../hooks';
import { Icon } from '../Icon';
import { Field } from './Field';
import { Sheet } from './Sheet';
import { merchantOf } from './TxnItem';

/** Re-files one transaction, optionally saving a rule so similar narrations follow. */
export function CategorySheet({ txn, onClose }: { txn: TxnRow; onClose: () => void }) {
  const actions = useActions();
  const [category, setCategory] = useState(txn.category ?? '');
  const [applyToAll, setApplyToAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const config = useCategoryConfig();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newExcluded, setNewExcluded] = useState(false);
  const [nameError, setNameError] = useState('');
  const pattern = rulePatternFor(txn.description);

  async function createCategory() {
    const created = await actions.addCategory(newName, newExcluded);
    if (created === null) {
      setNameError(newName.trim() === '' ? 'Enter a name' : 'That name is already used');
      return;
    }
    setCategory(created);
    setAdding(false);
    setNewName('');
    setNewExcluded(false);
    setNameError('');
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
        {allCategories(config).map((name) => (
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
        <button type="button" className="chip" aria-expanded={adding} onClick={() => setAdding((value) => !value)}>
          <Icon name="plus" size={16} /> New category
        </button>
      </div>
      {adding && (
        <div className="stack gap12" style={{ marginBottom: 16 }}>
          <Field id="new-category" label="Category name" value={newName} onChange={setNewName} error={nameError || undefined} />
          <label className="check">
            <input type="checkbox" checked={newExcluded} onChange={(event) => setNewExcluded(event.target.checked)} />
            <span>
              Doesn’t count as spending
              <span className="hint" style={{ display: 'block' }}>
                Left out of spending and income, like money you send to family.
              </span>
            </span>
          </label>
          <button type="button" className="btn out block" onClick={() => void createCategory()}>
            Add category
          </button>
        </div>
      )}
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
