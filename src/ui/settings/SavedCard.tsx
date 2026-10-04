import { useState } from 'react';
import { summariseRule } from '../../domain/ruleDraft';
import { useRules } from '../hooks';
import { RulesSheet } from '../rules/RulesSheet';

/** The categorisation rules the app applies, opened for editing in the rules sheet. */
export function SavedCard() {
  const rules = useRules();
  const [open, setOpen] = useState(false);
  const list = rules.data ?? [];

  return (
    <section className="card flat" aria-labelledby="saved-h">
      <h2 id="saved-h" className="t-title" style={{ padding: '16px 16px 4px' }}>
        Category rules
      </h2>
      {list.length === 0 ? (
        <p className="muted" style={{ padding: '4px 16px 8px' }}>
          None yet. Write one by hand, or change a transaction’s category and choose to apply it to similar ones.
        </p>
      ) : (
        <ul className="list">
          {list.map((rule) => (
            <li key={rule.id} className="row" style={{ minHeight: 56 }}>
              <span className="mid">
                <span className="ttl">{rule.name ?? (rule.pattern || rule.category)}</span>
                <span className="sub">{summariseRule(rule)}{rule.enabled === false ? ' · off' : ''}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ padding: '8px 16px 16px' }}>
        <button type="button" className="btn block out" onClick={() => setOpen(true)}>
          Manage rules
        </button>
      </div>
      {open && <RulesSheet onClose={() => setOpen(false)} />}
    </section>
  );
}
