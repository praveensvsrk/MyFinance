# MyFinance

> A private, offline-first personal finance tracker. Import the statements you already have and get a net-worth view, cash-flow summaries and planning tools, all in your browser.

[![CI](https://github.com/praveensvsrk/MyFinance/actions/workflows/ci.yml/badge.svg)](https://github.com/praveensvsrk/MyFinance/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 22](https://img.shields.io/badge/node-22-339933.svg)

**[Live demo](https://financeapp.praveensreepada.com/)** · [Supported sources](#supported-sources) · [Roadmap](#roadmap) · [Contributing](CONTRIBUTING.md)

<table align="center">
  <tr>
    <td width="25%"><img src="assets/screenshots/home.png" alt="Home: net worth with its trend and RSU vest markers, accounts by group, and what is coming up"></td>
    <td width="25%"><img src="assets/screenshots/cash-flow.png" alt="Cash flow: what was left over in a month, income against spending, and expenses by category"></td>
    <td width="25%"><img src="assets/screenshots/investments.png" alt="Mutual funds: portfolio value against money invested, XIRR and per-fund returns"></td>
    <td width="25%"><img src="assets/screenshots/plan.png" alt="Plan: a home-loan prepayment what-if showing the debt-free date and interest saved"></td>
  </tr>
  <tr align="center">
    <td><b>Net worth</b><br>All accounts, one number</td>
    <td><b>Cash flow</b><br>Where the money goes</td>
    <td><b>Investments</b><br>XIRR and cost basis</td>
    <td><b>Plan</b><br>Loan payoff, projections, goals</td>
  </tr>
</table>

<p align="center"><sub>Screenshots use made-up data.</sub></p>

## Why MyFinance

- 🔒 **Private by design.** There is no backend. Your data lives in IndexedDB on your device and never leaves it. The only network calls are public price lookups (see [Prices](#prices)).
- 📄 **Bring your own statements.** No bank logins or aggregators: import the PDFs and spreadsheets you already have.
- 📴 **Works offline.** Installable PWA with an update prompt, and a share target so you can share statements into the app from your phone.

> **Status: early development.** Parsers currently target Indian banks and instruments, and the app is mobile-first.

## Features

- **Import**: PDF, CSV and XLSX from the [supported sources](#supported-sources), with auto-detection, a preview with validation checks, duplicate detection and undo. A one-click sample data set for the live demo.
- **Net worth**: liquid cash, retirement (EPF, PPF), market holdings (mutual funds, employer stock), your home with the loan against it (so you see home equity), and a trend over time.
- **Cash flow**: monthly income and spending, your own categories and rules, a financial-year view against last year, and transfer matching so moves between your own accounts are not counted as income or spending.
- **Loans and mutual funds**: loan rate derivation and an amortisation what-if with prepayments; FIFO cost basis, XIRR, and provisional units for SIPs not yet on a CAS.
- **Equity compensation and planning**: RSU/ESPP lots, vest timeline and INR valuation; EPF/PPF projections and goal tracking.
- **Housekeeping**: notifications (the bell) for stale data, mismatches and upcoming dates, plus passphrase-encrypted backup and restore (PBKDF2 + AES).
- **Display**: light, dark or system theme; Accounts figures in thousands, lakhs or full rupees; and a one-tap switch to hide every amount.

## Supported sources

| Source | Format |
| --- | --- |
| Any bank or card (map the columns) | CSV / XLSX |
| SBI savings statement (including PPF balance) | PDF |
| Federal Bank savings statement | PDF |
| Union Bank of India savings statement | PDF |
| ICICI Bank credit card statement (password-protected) | PDF |
| Union Bank of India home-loan statement and interest certificate | PDF |
| EPFO member passbook | PDF |
| CAMS consolidated account statement (mutual funds) | PDF |
| E*TRADE / Morgan Stanley at Work client statement | PDF |
| E*TRADE Benefit History | XLSX |

CSV/Excel from HDFC, ICICI, SBI and Axis is recognised from the header row; for any other export you pick the date, description and amount columns. You can also add a savings or card account by hand from Accounts.

Missing a PDF parser for your bank? See [Adding a parser](CONTRIBUTING.md#adding-a-parser).

## How it works

```
PDF / XLSX  →  parsers  →  domain logic  →  IndexedDB (Dexie)  →  React UI
             (detect +    (pure, tested:    (integer paise,
              validate)    XIRR, net worth)   no float money)
```

Built with React 19, TypeScript, Vite, React Router (hash routing, so it works on static hosting), Dexie, pdf.js (text extraction in a worker), SheetJS, hand-drawn SVG charts and Workbox via `vite-plugin-pwa`. Tests use Vitest, Testing Library and Playwright.

## Prices

A daily refresh (at most once per 20 hours) stores prices in IndexedDB so the app keeps working offline:

- employer stock: [Finnhub](https://finnhub.io) quote API. Enter your own free API key in **Settings**; without one, the employer stock is simply not re-valued. The ticker is picked up from your E*TRADE imports.
- USD to INR: Frankfurter, with open.er-api.com as a fallback.
- mutual fund NAVs: mfapi.in.

These lookups send the employer ticker, fund names and ISINs to those services. The Finnhub key is kept encrypted (AES-GCM, with a non-extractable key held in a separate browser database), and a Content-Security-Policy limits the page to these hosts. Statement passwords are used for the import in progress and never stored.

## Roadmap

- More bank PDF parsers (HDFC, ICICI, Axis, SBI cards)

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers running it locally (Node 22), scripts, tests, fixtures and deployment.

## License

[MIT](LICENSE) © 2026 Praveen Sreepada
