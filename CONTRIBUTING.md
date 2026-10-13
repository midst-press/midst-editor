# Contributing to the Midst editor

Midst is a poetry editor that records the writing of a poem so it can be replayed. This repository is the
desktop app (Electron, React, TipTap). Thank you for helping.

## Where contributions go

Open issues and pull requests here, on GitHub (`midst-press/midst-editor`). Pull requests target `main`.
A pull request is merged when its CI is green and a maintainer has reviewed it.

Questions about how Midst should look or behave belong to the journal's editor, so please describe the
behaviour you see and the behaviour you expect, and let the maintainers route the decision.

## Never commit poem content

Poems written in Midst are the poets' work. Do not put any of it in this repository, an issue, a pull
request or a CI log: no `.midst` files from real poems, no poem text, and no titles or poets' names from
unpublished work. A pre-commit hook refuses the common file types, but it cannot recognise text, so the
responsibility is yours. Tests use synthetic poems written for the purpose.

## Licence

AGPL-3.0-or-later (`LICENSE`). By contributing you agree your contribution is licensed the same way. The
project's earlier MIT notice is kept in `LICENSE-MIT`.

## Setting up

- **Node:** the version in `.nvmrc` (CI reads the same file). `nvm use`, `fnm use` or similar.
- **npm only**, with the lockfile: `npm ci`. Use `npm install <pkg>` only when you mean to change
  dependencies, and commit the lockfile with it.

```
npm ci
npm start          # the app, in development mode
```

## Before you open a pull request

CI runs the pre-commit checks (defined in `.pre-commit-config.yaml`), the build, and the unit tests. The
end-to-end tests are not in CI; run them yourself.

`pre-commit` is a Python tool: `pipx install pre-commit==4.6.2` (the version CI uses; `uv tool install`
works too). Then, from a clone where `npm ci` has run:

```
pre-commit install            # once per clone
npm run build                 # the tests need the built app; they stop with a message if it is missing
pre-commit run --all-files    # formatting, type check, lint, and the poem-data and version rules
npm test -- --coverage        # unit tests (Jest), with the per-file coverage thresholds, as CI runs them
npm run e2e                   # end-to-end tests (Playwright, launches the built app)
```

**Known problem, being fixed:** with npm 12 (for example Homebrew's Node; check `npm --version`), `npm ci`
leaves Electron without its binary, so `npm run e2e` stops with "Electron failed to install correctly". The other
steps are unaffected. If you hit it, say so on your pull request rather than working around it.

- **Tests come with the change.** A bug fix carries a test that fails without it. Coverage thresholds are
  set per file in `package.json` (`jest.coverageThreshold`), so a drop fails CI.
- **The version** is kept the same in every place that states it; the `version-consistent` hook checks
  this. Releases follow `docs/releasing.md`, and a user-visible change gets a line in `CHANGELOG.md`.

## CI

`.github/workflows/ci.yml` runs on every pull request: the pre-commit checks, the build, and the unit tests
with coverage. Packaging (`package.yml`) and releasing (`release.yml`) are run by maintainers by hand;
see `docs/releasing.md` and `docs/macos-signing.md`.
