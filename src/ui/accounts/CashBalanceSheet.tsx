import { useState } from 'react';
import { useApp } from '../AppContext';
import { useActions } from '../actions';
import { isRealDate, parseRupees } from '../common/amount';
import { RupeeInput } from '../common/RupeeInput';
import { Sheet } from '../common/Sheet';

/** Records today's cash on hand (or any date); every entry is kept in the cash balance history. */
export function CashBalanceSheet({ onClose }: { onClose: () => void }) {
  const { today } = useApp();
  const actions = useActions();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const paise = parseRupees(amount);
  const valid = paise !== null && isRealDate(date) && date <= today;

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      await actions.setCashBalance(paise, date, note);
    } finally {
      onClose();
    }
  }

  return (
    <Sheet title="Cash balance" onClose={onClose}>
      <form
        className="stack gap16"
        style={{ marginTop: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="cash-amount">Amount</label>
          <div className={amount !== '' && paise === null ? 'inp err' : 'inp'}>
            <span className="pre">₹</span>
            <RupeeInput id="cash-amount" value={amount} onChange={setAmount} />
          </div>
          {amount !== '' && paise === null && <span className="hint err">Enter an amount in rupees, like 2500</span>}
        </div>
        <div className="field">
          <label htmlFor="cash-date">As of</label>
          <div className="inp">
            <input id="cash-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cash-note">Note (optional)</label>
          <div className="inp">
            <input id="cash-note" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <button type="submit" className={valid && !busy ? 'btn block fill' : 'btn block dis'} disabled={!valid || busy}>
          Save balance
        </button>
      </form>
    </Sheet>
  );
}
