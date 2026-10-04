# Contributing to MyFinance

Thanks for your interest! This guide covers local setup, tests, and how the code is organised.

## Setup

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

## Adding a parser

Each parser lives in `src/parsers/` and exposes:

- a `detect*` function that scores a document (so the importer can auto-detect the source), and
- a `parse*` function that produces typed records plus a validation report (running balances, printed totals and so on).

Register it in `src/parsers/index.ts`. Use `npm run dump -- <file.pdf>` to inspect the extracted text lines while
writing it. A file that fails validation can still be reviewed in the import preview, so prefer reporting problems
over throwing.

## Testing and fixtures

`npm test` runs without any private data. Tests that exercise the parsers against **real** statements are
skipped automatically when the files are absent. To run them, put your own statements under a git-ignored
`fixtures/` folder using the file names the tests expect (for example `fixtures/sbi/sbi_savings_<date>.pdf`),
and, for password-protected files, add a `fixtures/passwords.json` mapping the relative path to its password.
The expected figures in those tests are generic placeholders, so against your own statements you will need to
update them to match your documents.

The Playwright suite uses a small synthetic Benefit History workbook and mocks every price API, so it never
touches the network.

`fixtures/`, `docs/`, `.env` and `*.local` are git-ignored. **Never commit real statements, passwords or API keys.**

## Deployment

Pushes to `main` run [`deploy.yml`](.github/workflows/deploy.yml): typecheck, unit tests, e2e, then a build with
`BASE_PATH=/<repo name>/` that is published to GitHub Pages. Other branches and pull requests run
[`ci.yml`](.github/workflows/ci.yml) (typecheck, tests, build, e2e).

To host elsewhere, run `npm run build` and serve `dist/` from any static host (set `BASE_PATH` if it is not
served from `/`).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
