import { normaliseDescription } from './categorise';

/** Gateway tags in a merchant's UPI handle (`netflixupi.payu@hdfcbank`), not part of its name. */
const HANDLE_TAGS = new Set(['PAYU', 'RZP', 'RZ', 'CFP', 'CF', 'CB', 'BD', 'EASEBUZ', 'BRK', 'PG']);

/** Handles where the name is the gateway and the code after it is the merchant: keep it whole. */
const GATEWAYS = /^(?:BHARATPE|PAYTM|VYAPAR|GPAY|PHONEPE)\b/;

/**
 * The name in a UPI handle: the part before `@`, without gateway tags and a trailing shop number
 * (`crunchyrollindi518164.rz` gives `CRUNCHYROLLINDI`, `paytm-mygate@ptybl` gives `MYGATE`). A
 * phone number, a QR code or a gateway's merchant code has no name, so the handle is kept whole.
 */
export function handleName(handle: string): string {
  const upper = handle.toUpperCase().trim();
  const local = upper
    .split('@')[0]!
    .replace(/^(?:PAYTM|GPAY)-(?=[A-Z]{4})/, '');
  if (GATEWAYS.test(local)) return upper;
  for (const part of local.split('.')) {
    if (HANDLE_TAGS.has(part)) continue;
    const name = part.replace(/\d+$/, '');
    if ((name.match(/[A-Z]/g) ?? []).length >= 4) return name;
  }
  return upper;
}

/** Text before a `\` (card narrations put the merchant's address there), trimmed. */
function beforeAddress(text: string): string {
  return text.split('\\')[0]!.trim();
}

/** A card's forex markup, charged on its own row next to the payment (`TO INTL. ECM DCC/...`). */
export function isForexMarkup(description: string): boolean {
  return /^TO INTL\. ECM\b/.test(normaliseDescription(description));
}

/** `[pattern, how to read the payee from its match]`, first match wins. */
const SHAPES: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  // SBI and others: `UPI/DR/<ref>/<name>/<bank>/<handle>/...`; Federal: `UPIOUT/<ref>/<handle>/...`.
  [/(?:^|[^A-Z])UPI\/(?:DR|CR)\/\d+\/(M\/S\.?[^/]*|[^/]+)/, (m) => m[1]!],
  [/(?:^|[^A-Z])UPI(?:OUT| IN)\/\d+\/([^/]+)/, (m) => handleName(m[1]!)],
  // Older `UPI/<ref>/<name>/...`.
  [/(?:^|[^A-Z])UPI\/\d+\/([^/]+)/, (m) => m[1]!],
  // Federal card spends: `TO ECM/<ref>/<merchant> \<address>`, with the forex markup on its own
  // `TO INTL. ECM DCC/...` row, and `POS/<ref>/<merchant>/<time>`.
  [/^TO (?:INTL\. )?ECM(?: [A-Z]{3})?\/\d+\/(.+)$/, (m) => beforeAddress(m[1]!)],
  [/^POS\/\d+\/([^/]+)/, (m) => beforeAddress(m[1]!)],
  // SBI card spends: `POS ATM PURCH OTHPG <ref><merchant> <number>`.
  [/^POS ATM PURCH \w+ \d+(.+?)(?: [+\d][\d ]*)?$/, (m) => m[1]!],
  // Mandates: SBI `DEBIT ACHDR <mandate> <name>`, `ACH D- <name> <ref>`, Federal `ACHDR/<name>/...`.
  [/^DEBIT ACHDR \S+ (.+)$/, (m) => m[1]!],
  [/^ACH D- (.+?)(?: \d{6,})?$/, (m) => m[1]!],
  [/^ACHDR\/([^/]+)/, (m) => m[1]!],
  // SBI NEFT credits: `DEP TFR NEFT*<IFSC>*<ref>*<name>`.
  [/NEFT\*[^*]*\*[^*]*\*(.+)$/, (m) => m[1]!],
  // SBI IMPS: `WDL TFR IMPS/<ref>/<bank>-XX<digits>- <name>/<note>`.
  [/IMPS\/\d+\/(?:[A-Z]{4}-X+\d+- ?)?([^/]+)/, (m) => m[1]!],
  // SBI transfers to a named account: `... OF MR. <NAME> AT <branch>`.
  [/ OF (?:MR|MRS|MS|M\/S)\.? (.+?)(?: AT \d{5}.*)?$/, (m) => m[1]!],
];

/**
 * Who a narration pays or is paid by, as it is spelt in the narration (so it can be searched for
 * and used as a rule), or null when the narration has no recognisable payee.
 */
export function payeeOf(description: string): string | null {
  const text = normaliseDescription(description);
  for (const [shape, read] of SHAPES) {
    const match = text.match(shape);
    if (match === null) continue;
    const payee = read(match).replace(/\s+/g, ' ').trim();
    if (payee !== '') return payee;
  }
  return null;
}
