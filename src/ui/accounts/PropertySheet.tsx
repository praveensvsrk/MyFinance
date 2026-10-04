import { useState } from 'react';
import type { IsoDate, Paise } from '../../parsers/types';
import { useApp } from '../AppContext';
import { useActions } from '../actions';
import { isRealDate, parseRupees, rupeesText } from '../common/amount';
import { Sheet } from '../common/Sheet';

export interface PropertyDraft {
  name: string;
  balancePaise: Paise | null;
  date: IsoDate;
  annualPct: number;
}

/** A yearly change the user typed, or null when the text is not a number. Blank means no change. */
function parsePct(text: string): number | null {
  const cleaned = text.trim().replace(/%$/, '');
  if (cleaned === '') return 0;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Records what the home is worth. A later save on a new date keeps the earlier one. */
export function PropertySheet({ initial, onClose }: { initial?: PropertyDraft; onClose: () => void }) {
  const { today } = useApp();
  const actions = useActions();
  const [name, setName] = useState(initial?.name ?? 'Home');
  const [amount, setAmount] = useState(initial?.balancePaise == null ? '' : rupeesText(initial.balancePaise));
  const [date, setDate] = useState(initial?.date ?? today);
  const [pct, setPct] = useState(initial !== undefined && initial.annualPct !== 0 ? String(initial.annualPct) : '');
  const [busy, setBusy] = useState(false);

  const paise = parseRupees(amount);
  const annualPct = parsePct(pct);
  const pctOk = annualPct !== null && annualPct >= -20 && annualPct <= 30;
  const valid = name.trim() !== '' && paise !== null && paise > 0 && isRealDate(date) && date <= today && pctOk;

  async function save() {
    if (!valid || annualPct === null || paise === null || !isRealDate(date)) return;
    setBusy(true);
    try {
      await actions.saveProperty({ name, balance: paise, date, annualPct });
    } finally {
      onClose();
    }
  }

  return (
    <Sheet title="Your home" subtitle="What it is worth. The loan stays listed separately, as money you owe." onClose={onClose}>
      <form
        className="stack gap16"
        style={{ marginTop: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="home-name">Name</label>
          <div className="inp">
            <input id="home-name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="home-amount">Value</label>
          <div className={amount !== '' && (paise === null || paise <= 0) ? 'inp err' : 'inp'}>
            <span className="pre">₹</span>
            <input id="home-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </div>
          {amount !== '' && (paise === null || paise <= 0) && <span className="hint err">Enter the value in rupees, like 8500000</span>}
        </div>
        <div className="field">
          <label htmlFor="home-date">Valued on</label>
          <div className="inp">
            <input id="home-date" type="date" max={today} value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="home-pct">Yearly change (optional)</label>
          <div className={pct.trim() !== '' && !pctOk ? 'inp err' : 'inp'}>
            <input id="home-pct" inputMode="decimal" autoComplete="off" placeholder="0" value={pct} onChange={(event) => setPct(event.target.value)} />
            <span className="pre">%</span>
          </div>
          <span className={pct.trim() !== '' && !pctOk ? 'hint err' : 'hint'}>
            {pct.trim() !== '' && !pctOk ? 'Use a number from -20 to 30' : 'Left blank, the value stays put until you update it.'}
          </span>
        </div>
        <button type="submit" className={valid && !busy ? 'btn block fill' : 'btn block dis'} disabled={!valid || busy}>
          Save value
        </button>
      </form>
    </Sheet>
  );
}
