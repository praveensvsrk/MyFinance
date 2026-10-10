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
   sources first. (CSV/XLSX that is not an E*TRADE Benefit History goes through the generic column mapper in
   `src/parsers/generic.ts`. A new named spreadsheet source needs its own branch in `parseFile`.)
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
`fixtures/` folder using the file names the tests expect (for example `fixtures/sbi/savings.pdf`),
and, for password-protected files, add a `fixtures/passwords.json` mapping the relative path to its password.
The tests that assert exact figures (balances, quantities, grant numbers) are generic placeholders, so they are
skipped even when the files are present. To run them, set `REAL_FIXTURE_VALUES=1` and update the expected
figures to match your own documents. Detection, password and import tests run whenever the files exist.

The Playwright suite uses a small synthetic Benefit History workbook and mocks every price API, so it never
touches the network.

`fixtures/`, `docs/`, `.env` and `*.local` are git-ignored. **Never commit real statements, passwords or API keys.**

## README screenshots

`npm run screenshots` starts the dev server, opens the app in a phone-sized Chrome (set `CHROME_PATH` to use a
specific Chromium), fills its database from `src/demo/seed.ts` and saves one PNG per screen. The seed is a
made-up person generated from a fixed random seed, and the page clock is pinned to `DEMO_TODAY`, so the same
images come out on every run. The live app's **Try with sample data** button runs the same seeder. Re-run
screenshots whenever a screen changes visibly, and keep the PNGs small.

You can also run the **Screenshots** workflow from the Actions tab. It regenerates the PNGs on GitHub's runner and
opens a pull request with any that changed.

## Deployment

[`ci.yml`](.github/workflows/ci.yml) runs typecheck, unit tests, build and e2e on every pull request and on every push.
The live site is built and deployed by Cloudflare each time `main` changes (see below); Cloudflare does not wait for
CI, so require the CI check on pull requests in the branch protection rules.

To host elsewhere, run `npm run build` and serve `dist/` from any static host (set `BASE_PATH` if it is not
served from `/`).

### Hosting on its own origin (Cloudflare Pages)

Browsers keep the app's data per origin, and every GitHub Pages site under `<user>.github.io` shares one
origin. If you keep real data in the app, host it where nothing else shares its origin. On Cloudflare Pages
(free) connect the repository with build command `npm run build` and output directory `dist`. `BASE_PATH` is
left unset because the site is served from `/`, and [`.node-version`](.node-version) selects Node 22.
[`public/_headers`](public/_headers) adds `frame-ancestors 'none'` and other response headers; Netlify reads
the same file. A new origin starts empty, so move data across with Settings → Backup.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
