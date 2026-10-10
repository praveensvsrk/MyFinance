import type { AmountUnit } from '../../domain/money';
import { useApp, type ThemeChoice } from '../AppContext';

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const UNIT_OPTIONS: { value: AmountUnit; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'thousands', label: 'Thousands' },
  { value: 'lakhs', label: 'Lakhs' },
  { value: 'rupees', label: 'Rupees' },
];

/** Theme (light, dark or system) and the unit the Accounts screen shows amounts in. */
export function DisplayCard() {
  const { theme, setTheme, amountUnit, setAmountUnit } = useApp();
  return (
    <section className="card" aria-labelledby="display-h">
      <h2 id="display-h" className="t-title">
        Display
      </h2>
      <div className="stack gap12" style={{ marginTop: 12 }}>
        <div>
          <span className="ttl" id="theme-label">
            Theme
          </span>
          <div className="seg block" role="group" aria-labelledby="theme-label" style={{ marginTop: 8 }}>
            {THEME_OPTIONS.map((option) => (
              <button key={option.value} type="button" className={option.value === theme ? 'on' : ''} aria-pressed={option.value === theme} onClick={() => setTheme(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="ttl" id="unit-label">
            Amounts in Accounts
          </span>
          <span className="sub" style={{ display: 'block' }}>
            Default uses K, L and Cr as required; the others use one unit everywhere.
          </span>
          <div className="seg block" role="group" aria-labelledby="unit-label" style={{ marginTop: 8 }}>
            {UNIT_OPTIONS.map((option) => (
              <button key={option.value} type="button" className={option.value === amountUnit ? 'on' : ''} aria-pressed={option.value === amountUnit} onClick={() => setAmountUnit(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
