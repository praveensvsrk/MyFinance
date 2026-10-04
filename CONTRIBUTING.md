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
| `npm run screenshots` | Regenerate the README screenshots in `assets/screenshots/` from made-up data (see below) |

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

Each parser lives in `src/parsers/` and exposes a `detect*` function that scores a document (so the importer can
auto-detect the source) and a `parse*` function that produces typed records plus a validation report (running
balances, printed totals and so on). Use `npm run dump -- <file.pdf>` to inspect the extracted text lines while
writing it. A file that fails validation can still be reviewed in the import preview, so prefer reporting problems
over throwing.

A new source touches several places. The compiler will point you at most of them:

1. **`src/parsers/types.ts`**: add the source id to the record type (for a bank statement, add it to `BankSource`
   and use any `institution` string) and to the `ParsedFile` union, which defines `SourceId`.
2. **`src/parsers/<name>.ts`**: write `detect*` and `parse*`.
3. **`src/parsers/index.ts`**: add a row to `PDF_PARSERS`. Order only matters for ties, so put more specific
   sources first. (A new spreadsheet source needs its own branch in `parseFile`; only E*TRADE uses XLSX today.)
4. **`src/services/mappers/`**: write a mapper from the parsed file to database rows.
5. **`src/services/importPipeline.ts`**: register the mapper in `MAPPERS`. It is a `Record<SourceId, Mapper>`,
   so a missing entry fails typecheck.
6. **`src/ui/useImportHistory.ts`**: add a label to `SOURCE_LABELS` (also exhaustive).
7. **`src/services/accounts.ts`**: check whether the new account kind needs handling there.
8. **Tests**: add `tests/parsers/<name>.test.ts` with synthetic data, and a case in `tests/parsers/index.test.ts`
   (skipped when the real fixture is absent). `tests/services/sourceRegistry.test.ts` checks the registry is complete.
9. **README**: add the source to the "Supported sources" table.

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

## README screenshots

`npm run screenshots` starts the dev server, opens the app in a phone-sized Chrome (set `CHROME_PATH` to use a
specific Chromium), fills its database from `scripts/demo/seed.ts` and saves one PNG per screen. The seed is a
made-up person generated from a fixed random seed, and the page clock is pinned to `DEMO_TODAY`, so the same
images come out on every run. Re-run it whenever a screen changes visibly, and keep the PNGs small.

## Deployment

Pushes to `main` run [`deploy.yml`](.github/workflows/deploy.yml): typecheck, unit tests, e2e, then a build with
`BASE_PATH=/<repo name>/` that is published to GitHub Pages. Other branches and pull requests run
[`ci.yml`](.github/workflows/ci.yml) (typecheck, tests, build, e2e).

To host elsewhere, run `npm run build` and serve `dist/` from any static host (set `BASE_PATH` if it is not
served from `/`).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
