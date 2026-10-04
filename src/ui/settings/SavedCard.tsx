import { useActions } from '../actions';
import { Icon } from '../Icon';
import { useRules } from '../hooks';

/** Categorisation rules the app remembers, each removable. */
export function SavedCard() {
  const actions = useActions();
  const rules = useRules();

  return (
    <section className="card flat" aria-labelledby="saved-h">
      <h2 id="saved-h" className="t-title" style={{ padding: '16px 16px 4px' }}>
        Category rules
      </h2>
      {(rules.data ?? []).length === 0 ? (
        <p className="muted" style={{ padding: '4px 16px 16px' }}>
          None yet. Change a transaction’s category and choose to apply it to similar ones.
        </p>
      ) : (
        <ul className="list">
          {(rules.data ?? []).map((rule) => (
            <li key={rule.id} className="row" style={{ minHeight: 56 }}>
              <span className="mid">
                <span className="ttl">{rule.pattern}</span>
                <span className="sub">Goes to {rule.category}</span>
              </span>
              <button type="button" className="ib sm" aria-label={`Delete the rule for ${rule.pattern}`} onClick={() => void actions.deleteRule(rule.id)}>
                <Icon name="trash" size={20} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
