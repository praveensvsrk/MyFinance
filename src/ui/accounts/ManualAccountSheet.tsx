import { useState } from 'react';
import { useApp } from '../AppContext';
import { useActions } from '../actions';
import { isRealDate, parseRupees } from '../common/amount';
import { RupeeInput } from '../common/RupeeInput';
import { Sheet } from '../common/Sheet';

/** Adds a savings or card account by hand when there is no statement for it yet. */
export function ManualAccountSheet({ onClose }: { onClose: () => void }) {
  const { today } = useApp();
  const actions = useActions();
  const [kind, setKind] = useState<'savings' | 'card'>('savings');
  const [institution, setInstitution] = useState('');
  const [last4, setLast4] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const paise = parseRupees(amount);
  const valid = institution.trim() !== '' && paise !== null && isRealDate(date) && date <= today;

  async function save() {
    if (!valid || paise === null) return;
    setBusy(true);
    try {
      await actions.saveManualAccount({
        kind,
        institution: institution.trim(),
        maskedNumber: last4,
        balance: paise,
        date,
      });
    } finally {
      onClose();
    }
  }

  return (
    <Sheet
      title="Add an account"
      subtitle="For a bank without a PDF parser; a CSV can be imported later onto the same last four digits."
      onClose={onClose}
    >
      <form
        className="stack gap16"
        style={{ marginTop: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <span className="fl">Type</span>
          <label className="radio">
            <input type="radio" name="manual-kind" checked={kind === 'savings'} onChange={() => setKind('savings')} />
            Savings / current
          </label>
          <label className="radio">
            <input type="radio" name="manual-kind" checked={kind === 'card'} onChange={() => setKind('card')} />
            Credit card
          </label>
        </div>
        <div className="field">
          <label htmlFor="manual-bank">Bank</label>
          <div className="inp">
            <input id="manual-bank" autoComplete="off" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="HDFC" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="manual-last4">Last 4 digits (optional)</label>
          <div className="inp">
            <input id="manual-last4" inputMode="numeric" autoComplete="off" value={last4} onChange={(e) => setLast4(e.target.value)} placeholder="4821" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="manual-amount">{kind === 'card' ? 'Amount owed' : 'Balance'}</label>
          <div className={amount !== '' && paise === null ? 'inp err' : 'inp'}>
            <span className="pre">₹</span>
            <RupeeInput id="manual-amount" value={amount} onChange={setAmount} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="manual-date">As of</label>
          <div className="inp">
            <input id="manual-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <button type="submit" className={valid && !busy ? 'btn block fill' : 'btn block dis'} disabled={!valid || busy}>
          Save account
        </button>
      </form>
    </Sheet>
  );
}
