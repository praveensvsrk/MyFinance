# MyFinance

<img width="200"  alt="mf1" src="https://github.com/user-attachments/assets/53af8f9d-42e1-4c39-b935-972dd788a31d" />
<img width="200"  alt="mf2" src="https://github.com/user-attachments/assets/d890eb11-c4e7-452b-95cb-33db3c824abd" />
<img width="200"  alt="mf3" src="https://github.com/user-attachments/assets/f8fea0fc-2477-44a5-a412-5f827ed5cb19" />

A private, offline-first personal finance tracker that runs entirely in your browser as an installable PWA.
You import statements you already have (bank PDFs, loan statements, EPF passbooks, mutual-fund CAS,
broker statements), and the app turns them into a net-worth view, cash-flow summaries and planning tools.

> **Status:** early development. The parsers, domain logic, services and import flow are implemented and tested.
> The Home, Cash Flow, Accounts and Plan screens are still placeholders that render their data as JSON, so the
> features below describe what the data layer computes, not a finished UI.

**Your data never leaves the device.** There is no backend. Everything is stored in IndexedDB, and the only
network calls are public price lookups (see [Prices](#prices)).

## Features

- **Statement import** from PDF and XLSX, with source auto-detection, password-protected PDFs (passwords can
  be remembered locally), a preview step with validation checks, duplicate detection and undo.
- **Net worth** across liquid cash, retirement (EPF, PPF), market holdings (mutual funds, employer stock) and
  liabilities (home loan), with a trend over time.
- **Cash flow**: monthly income and spending, rule-based categorisation, transfer matching between your own
  accounts so transfers are not counted as income or spending.
- **Loan tools**: rate derivation from statements and an amortisation what-if with prepayments
  (reduce tenure or reduce EMI).
- **Mutual funds**: FIFO cost basis, XIRR, and provisional units for SIPs that have not yet appeared on a CAS.
- **Equity compensation**: RSU/ESPP lots, vest timeline and valuation in INR.
- **Planning**: EPF/PPF projections and goal tracking.
- **Needs-attention list** for stale data, mismatches and upcoming dates.
- **Encrypted backup and restore** (passphrase-based, PBKDF2 + AES).
- **PWA**: installable, works offline, update prompt, and a share target so statements can be shared into the app
  from a phone.

## Supported sources

| Source | Format |
| --- | --- |
| SBI savings statement (including PPF balance) | PDF |
| Federal Bank savings statement | PDF |
| Union Bank of India savings statement | PDF |
| Union Bank of India home-loan statement and interest certificate | PDF |
| EPFO member passbook | PDF |
| CAMS consolidated account statement (mutual funds) | PDF |
| E*TRADE / Morgan Stanley at Work client statement | PDF |
| E*TRADE Benefit History | XLSX |

Each parser has a `detect*` function that scores a document and a `parse*` function that produces typed records
plus a validation report (running balances, printed totals and so on). A file that fails validation can still
be reviewed in the preview before anything is committed.

## Tech stack

React 19, TypeScript, Vite, React Router (hash routing, so it works on static hosting), Dexie (IndexedDB),
pdf.js (text extraction in a worker), SheetJS (XLSX), ECharts (lazy-loaded), and Workbox via `vite-plugin-pwa`.
Tests use Vitest, Testing Library and Playwright.

## Getting started

Requires Node 22.

```bash
npm ci
npm run dev        # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run e2e` | Playwright end-to-end tests (builds and serves the app itself) |
| `npm run dump -- <file.pdf>` | Print the extracted text lines of a PDF, for writing or debugging a parser |

## Configuration

There is nothing to configure for the employer stock. Its ticker is read from the E*TRADE files you
import: the `Symbol` column of the Benefit History workbook and the `<COMPANY> (<SYMBOL>)` holding
row of the client statement. It is kept in the app's settings, and the latest import wins. Until one
is imported there is no employer stock, so no quote is fetched and no price warning is shown.

### Prices

A daily refresh (at most once per 20 hours) stores prices in IndexedDB so the app keeps working offline:

- employer stock: [Finnhub](https://finnhub.io) quote API. Enter your own free API key in **Settings**.
- USD to INR: Frankfurter, with open.er-api.com as a fallback.
- mutual fund NAVs: mfapi.in.

Without a Finnhub key the app still works; the employer stock is simply not re-valued.

## Project layout

```
src/
  parsers/    PDF/XLSX parsers: source detection, typed records, validation
  domain/     Pure logic: money, dates, XIRR, categorisation, transfers, net worth, loans, EPF, MF, projections
  db/         Dexie schema and repositories
  services/   Import pipeline, mappers (parsed file -> DB rows), dashboard queries, prices, backup, user actions
  pwa/        Service worker, PDF worker, share target, startup persistence
  ui/         React app: shell, pages, charts, hooks
tests/        Mirrors src/, plus tests/e2e for Playwright
scripts/      Developer tools (PDF text dump, icon generation)
```

Amounts are stored as integer **paise** (and USD **cents**) throughout, so there is no floating-point money.
Domain code is pure and unit-tested; parsers and services are tested with synthetic data.

## Testing and fixtures

`npm test` runs without any private data. Tests that exercise the parsers against **real** statements are
skipped automatically when the files are absent. To run them, put your own statements under a git-ignored
`fixtures/` folder using the file names the tests expect (for example `fixtures/sbi/sbi_savings_<date>.pdf`),
and, for password-protected files, add a `fixtures/passwords.json` mapping the relative path to its password.
The expected figures in those tests are generic placeholders, so against your own statements you will need to
update them to match your documents.

The Playwright suite uses a small synthetic Benefit History workbook and mocks every price API, so it never
touches the network.

`fixtures/`, `docs/`, `.env` and `*.local` are git-ignored. Never commit real statements, passwords or API keys.

## Deployment

Pushes to `main` run [`deploy.yml`](.github/workflows/deploy.yml): typecheck, unit tests, e2e, then a build with
`BASE_PATH=/<repo name>/` that is published to GitHub Pages. Other branches and pull requests run
[`ci.yml`](.github/workflows/ci.yml) (typecheck, tests, build, e2e).

To host elsewhere, run `npm run build` and serve `dist/` from any static host (set `BASE_PATH` if it is not
served from `/`).
