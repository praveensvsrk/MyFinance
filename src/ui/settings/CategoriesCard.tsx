import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { allCategories } from '../../domain/categories';
import { useActions } from '../actions';
import { Field } from '../common/Field';
import { Icon } from '../Icon';
import { useCategoryConfig } from '../hooks';

/** Where Settings was opened from, so creating a category can send you back to it. */
interface CreateState {
  newCategory?: boolean;
  returnTo?: string;
}

/** Name and "not spending" choice for a new category; the only place categories are created. */
function NewCategory({ startOpen, returnTo }: { startOpen: boolean; returnTo?: string }) {
  const actions = useActions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState('');
  const [excluded, setExcluded] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!startOpen) return;
    box.current?.scrollIntoView?.({ block: 'center' });
    document.getElementById('new-category')?.focus();
  }, [startOpen]);

  async function create() {
    const created = await actions.addCategory(name, excluded);
    if (created === null) {
      setError(name.trim() === '' ? 'Enter a name' : 'That name is already used');
      return;
    }
    setName('');
    setExcluded(false);
    setError('');
    setOpen(false);
    if (returnTo !== undefined) navigate(returnTo, { replace: true });
  }

  return (
    <div ref={box} className="stack gap12" style={{ padding: '0 16px 16px' }}>
      {open ? (
        <>
          <Field id="new-category" label="Category name" value={name} onChange={setName} error={error || undefined} />
          <label className="check">
            <input type="checkbox" checked={excluded} onChange={(event) => setExcluded(event.target.checked)} />
            <span>
              Doesn’t count as spending
              <span className="hint" style={{ display: 'block' }}>
                Left out of spending and income, like money you send to family.
              </span>
            </span>
          </label>
          <div className="row-between">
            <button type="button" className="btn out" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn fill" onClick={() => void create()}>
              Add category
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn out block" onClick={() => setOpen(true)}>
          <Icon name="plus" size={20} /> New category
        </button>
      )}
    </div>
  );
}

/** Every category, with a switch for the ones that should not count as spending, and a way to add one. */
export function CategoriesCard() {
  const actions = useActions();
  const config = useCategoryConfig();
  const state = (useLocation().state ?? null) as CreateState | null;

  return (
    <section className="card flat" aria-labelledby="cats-h">
      <h2 id="cats-h" className="t-title" style={{ padding: '16px 16px 0' }}>
        Categories
      </h2>
      <p className="muted" style={{ padding: '4px 16px 8px' }}>
        Switch on “Not spending” for money you send on, such as family. It is left out of spending and income
        everywhere. Add your own below; they can then be used when you change a transaction’s category or write a rule.
      </p>
      <ul className="list">
        {allCategories(config).map((name) => {
          const custom = config.custom.includes(name);
          const id = `cat-${name.replace(/\W+/g, '-')}`;
          return (
            <li key={name} className="row" style={{ minHeight: 56 }}>
              <span className="mid">
                <span className="ttl" id={id}>
                  {name}
                </span>
                <span className="sub">Not spending</span>
              </span>
              <span className="sw">
                <input
                  type="checkbox"
                  role="switch"
                  aria-labelledby={id}
                  checked={config.excluded.includes(name)}
                  onChange={(event) => void actions.setCategoryExcluded(name, event.target.checked)}
                />
                <span className="track" />
              </span>
              {custom && (
                <button
                  type="button"
                  className="ib sm"
                  aria-label={`Delete the ${name} category`}
                  onClick={() => void actions.deleteCategory(name)}
                >
                  <Icon name="trash" size={20} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <NewCategory startOpen={state?.newCategory === true} returnTo={state?.returnTo} />
    </section>
  );
}
