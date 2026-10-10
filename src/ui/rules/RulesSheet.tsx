import { useState } from 'react';
import type { RuleRow } from '../../db/schema';
import { summariseRule } from '../../domain/ruleDraft';
import { useActions } from '../actions';
import { Sheet } from '../common/Sheet';
import { Icon } from '../Icon';
import { useRules } from '../hooks';
import { RuleEditor } from './RuleEditor';

/** Your categorisation rules, in the order they are tried, with an editor for each. */
export function RulesSheet({ onClose, startNew = false }: { onClose: () => void; startNew?: boolean }) {
  const actions = useActions();
  const loaded = useRules().data;
  const rules = loaded ?? [];
  const [editing, setEditing] = useState<RuleRow | 'new' | null>(startNew ? 'new' : null);

  if (editing !== null) {
    return (
      <Sheet
        key="editor"
        title={editing === 'new' ? 'New rule' : 'Edit rule'}
        subtitle="Pick the conditions and category; the preview shows what changes."
        onClose={onClose}
        testId="rule-editor"
      >
        <RuleEditor rule={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      </Sheet>
    );
  }

  return (
    <Sheet
      key="list"
      title="Rules"
      subtitle="Rules run top to bottom; the first match wins."
      onClose={onClose}
      testId="rules-list"
    >
      {loaded === undefined ? null : rules.length === 0 ? (
        <p className="muted" style={{ margin: '16px 0' }}>
          No rules yet. A rule categorizes matching transactions on every import.
        </p>
      ) : (
        <ul className="list" style={{ margin: '12px -20px' }}>
          {rules.map((rule, index) => {
            const title = rule.name ?? (rule.pattern || rule.category);
            return (
              <li key={rule.id} className="row" style={{ minHeight: 64 }}>
                <span className="sw">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`Rule ${title} is on`}
                    checked={rule.enabled !== false}
                    onChange={(event) => void actions.setRuleEnabled(rule.id, event.target.checked)}
                  />
                  <span className="track" />
                </span>
                <button
                  type="button"
                  className="mid"
                  style={{ textAlign: 'left', opacity: rule.enabled === false ? 0.6 : 1 }}
                  aria-label={`Edit rule ${title}`}
                  onClick={() => setEditing(rule)}
                >
                  <span className="ttl">{title}</span>
                  <span className="sub">{summariseRule(rule)}</span>
                </button>
                <button
                  type="button"
                  className="ib sm"
                  aria-label={`Move ${title} up`}
                  disabled={index === 0}
                  onClick={() => void actions.moveRule(rule.id, 'up')}
                >
                  <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
                    <Icon name="down" size={20} />
                  </span>
                </button>
                <button
                  type="button"
                  className="ib sm"
                  aria-label={`Move ${title} down`}
                  disabled={index === rules.length - 1}
                  onClick={() => void actions.moveRule(rule.id, 'down')}
                >
                  <Icon name="down" size={20} />
                </button>
                <button
                  type="button"
                  className="ib sm"
                  aria-label={`Delete rule ${title}`}
                  onClick={() => void actions.deleteRule(rule.id)}
                >
                  <Icon name="trash" size={20} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="cap" style={{ marginBottom: 12 }}>
        Deleting or turning off a rule doesn’t change already categorized transactions.
      </p>
      <button type="button" className="btn block fill" onClick={() => setEditing('new')}>
        <Icon name="plus" size={20} /> New rule
      </button>
    </Sheet>
  );
}
