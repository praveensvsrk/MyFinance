import { useMemo, useState } from 'react';
import { guessMapping, mappingFromGuess, parseGeneric, type GenericMapping, type SpreadsheetTable } from '../../parsers';
import { Field } from '../common/Field';
import { Icon } from '../Icon';
import { Money } from '../Money';
import type { ImportFlow } from '../useImportFlow';

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  optional,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  optional?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="inp">
        <select id={id} className="sel-in" value={value} onChange={(event) => onChange(event.target.value)}>
          {optional && <option value="">Not used</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function colKey(index: number | undefined): string {
  return index === undefined ? '' : String(index);
}

function parseCol(value: string): number | undefined {
  if (value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Map columns of a CSV/Excel export onto a savings or card account. */
export function MappingCard({
  state,
  flow,
}: {
  state: { fileName: string; table: SpreadsheetTable };
  flow: ImportFlow;
}) {
  const initial = useMemo(() => guessMapping(state.table), [state.table]);
  const [institution, setInstitution] = useState(initial.institution ?? '');
  const [last4, setLast4] = useState('');
  const [kind, setKind] = useState<'savings' | 'card'>(initial.kind ?? 'savings');
  const [headerRow, setHeaderRow] = useState(String(initial.headerRow));
  const [dateCol, setDateCol] = useState(colKey(initial.dateCol));
  const [descriptionCol, setDescriptionCol] = useState(colKey(initial.descriptionCol));
  const [amountCol, setAmountCol] = useState(colKey(initial.amountCol));
  const [debitCol, setDebitCol] = useState(colKey(initial.debitCol));
  const [creditCol, setCreditCol] = useState(colKey(initial.creditCol));
  const [balanceCol, setBalanceCol] = useState(colKey(initial.balanceCol));
  const [refCol, setRefCol] = useState(colKey(initial.refCol));
  const [drcrCol, setDrcrCol] = useState(colKey(initial.drcrCol));
  const headerIndex = Number(headerRow) || 0;
  const headers = state.table.rows[headerIndex] ?? [];
  const colOptions = headers.map((header, index) => ({
    value: String(index),
    label: header === '' ? `Column ${index + 1}` : header,
  }));
  const headerOptions = state.table.rows.slice(0, Math.min(state.table.rows.length, 15)).map((row, index) => ({
    value: String(index),
    label: `Row ${index + 1}: ${row.filter((cell) => cell !== '').slice(0, 4).join(' · ') || '(empty)'}`,
  }));

  const mapping: GenericMapping | null = useMemo(() => {
    try {
      return mappingFromGuess(
        {
          headerRow: headerIndex,
          dateCol: parseCol(dateCol),
          descriptionCol: parseCol(descriptionCol),
          amountCol: parseCol(amountCol),
          debitCol: parseCol(debitCol),
          creditCol: parseCol(creditCol),
          balanceCol: parseCol(balanceCol),
          refCol: parseCol(refCol),
          drcrCol: parseCol(drcrCol),
          dateFormat: initial.dateFormat,
          preset: initial.preset,
          institution: initial.institution,
          kind,
        },
        { institution, accountLast4: last4, kind },
      );
    } catch {
      return null;
    }
  }, [
    amountCol,
    balanceCol,
    creditCol,
    dateCol,
    debitCol,
    descriptionCol,
    drcrCol,
    headerIndex,
    initial.dateFormat,
    initial.institution,
    initial.preset,
    institution,
    kind,
    last4,
    refCol,
  ]);

  const preview = useMemo(() => {
    if (mapping === null) return null;
    try {
      return parseGeneric(state.table, mapping);
    } catch (error) {
      return (error as Error).message;
    }
  }, [mapping, state.table]);

  const parsed = typeof preview === 'object' && preview !== null ? preview : null;
  const error = typeof preview === 'string' ? preview : mapping === null ? 'Pick date, description and amount, or debit and credit.' : null;
  const last4Clean = last4.replace(/\D/g, '').slice(-4);
  const canContinue = parsed !== null && parsed.txns.length > 0 && institution.trim() !== '' && last4Clean.length >= 1;

  return (
    <section className="card stack gap16">
      <div>
        <h2 className="t-title">Match the columns</h2>
        <span className="sub">{state.fileName}</span>
        {initial.preset && <span className="tag acc" style={{ marginTop: 8, display: 'inline-flex' }}>{initial.preset}</span>}
      </div>
      <p className="muted">
        Point each field at its column; the last four digits keep this account distinct.
      </p>
      <Field id="map-bank" label="Bank name" value={institution} onChange={setInstitution} placeholder="HDFC" />
      <Field
        id="map-last4"
        label="Last 4 digits of the account"
        value={last4}
        onChange={setLast4}
        inputMode="numeric"
        placeholder="4821"
      />
      <SelectField
        id="map-kind"
        label="Account type"
        value={kind}
        onChange={(value) => setKind(value === 'card' ? 'card' : 'savings')}
        options={[
          { value: 'savings', label: 'Savings / current' },
          { value: 'card', label: 'Credit card' },
        ]}
      />
      <SelectField id="map-header" label="Header row" value={headerRow} onChange={setHeaderRow} options={headerOptions} />
      <SelectField id="map-date" label="Date" value={dateCol} onChange={setDateCol} options={colOptions} />
      <SelectField id="map-desc" label="Description" value={descriptionCol} onChange={setDescriptionCol} options={colOptions} />
      <SelectField id="map-debit" label="Debit / withdrawal" value={debitCol} onChange={setDebitCol} options={colOptions} optional />
      <SelectField id="map-credit" label="Credit / deposit" value={creditCol} onChange={setCreditCol} options={colOptions} optional />
      <SelectField id="map-amount" label="Amount (if not split into debit/credit)" value={amountCol} onChange={setAmountCol} options={colOptions} optional />
      <SelectField id="map-drcr" label="Dr/Cr column" value={drcrCol} onChange={setDrcrCol} options={colOptions} optional />
      <SelectField id="map-balance" label="Balance" value={balanceCol} onChange={setBalanceCol} options={colOptions} optional />
      <SelectField id="map-ref" label="Reference" value={refCol} onChange={setRefCol} options={colOptions} optional />

      {error !== null && (
        <div className="note warn">
          <Icon name="info" size={20} />
          <span>{error}</span>
        </div>
      )}
      {parsed !== null && (
        <div>
          <span className="t-label">First rows</span>
          <ul className="list" style={{ marginTop: 8 }}>
            {parsed.txns.slice(0, 5).map((txn, i) => (
              <li key={`${txn.date}-${i}`} className="row" style={{ minHeight: 48, padding: '8px 0' }}>
                <span className="mid">
                  <span className="ttl">{txn.description}</span>
                  <span className="sub">{txn.date}</span>
                </span>
                <span className={txn.amount < 0 ? 'amt' : 'amt in'}>
                  <Money paise={txn.amount} />
                </span>
              </li>
            ))}
          </ul>
          <span className="cap">{parsed.txns.length} transactions · {parsed.periodFrom} to {parsed.periodTo}</span>
        </div>
      )}
      <button
        type="button"
        className={canContinue ? 'btn block fill' : 'btn block dis'}
        disabled={!canContinue}
        onClick={() => {
          if (mapping !== null) flow.submitMapping(mapping);
        }}
      >
        Review
      </button>
      <button type="button" className="btn block text" onClick={flow.reset}>
        Cancel
      </button>
    </section>
  );
}
