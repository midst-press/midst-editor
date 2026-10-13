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

`npm run e2e`, `npm start` and `npm run coverage` first put Electron's binary in place
(`tools/install-electron.cjs`; the first run downloads it). `npm ci` alone does not: Electron's own install step
does not complete on Node 26 (seen on 26.7.0), whether or not npm runs it. If you see "Electron failed to install
correctly", run `node tools/install-electron.cjs` and include what it prints in your report.

- **Tests come with the change.** A bug fix carries a test that fails without it. Coverage thresholds are
  set per file in `package.json` (`jest.coverageThreshold`), so a drop fails CI.
- **The version** is kept the same in every place that states it; the `version-consistent` hook checks
  this. Releases follow `docs/releasing.md`.
- **A user-visible change gets a line in `CHANGELOG.md`**, as described next.
- **Commit messages and pull-request titles say `Refs #12`, not `Fixes #12` or `Closes #12`.** A closing
  keyword there closes the issue the moment the commit reaches `main`, before anyone has checked the fix in
  a release. The `commit-msg` hook that `pre-commit install` sets up refuses one.

## The changelog

`CHANGELOG.md` has one entry per version, under a heading that is exactly `# <version>`, newest first.
The release workflow (`.github/workflows/release.yml`) publishes that entry as the release notes.

- **Where your line goes.** Under the heading for the version in `release/app/package.json`, which is
  the next release. If that version is already released (a `v<version>` tag exists), or someone outside
  the project already has a build of it, it is finished: run `tools/set_version.sh <next version>` and
  start a new heading. Two different builds must never carry one version number.
- **The entry must be complete before packaging.** The release workflow reads `CHANGELOG.md` at the
  commit the installers were built from, not at the tip of `main`, and refuses a version with no entry
  or an empty one. A line merged after the package run is not in that release's notes.
- **An entry says what that build contains, and is not edited after release.** A fix that came later
  goes under the later version, even if it was meant for the earlier one.
- **Write for poets.** Say what changed for someone using Midst, in plain words, one bold lead sentence
  per change. Internal changes (tests, tooling, CI, dependencies) are summarised in a single last line
  beginning "Under the hood:".

## CI

`.github/workflows/ci.yml` runs on every pull request: the pre-commit checks, the build, and the unit tests
with coverage. Packaging (`package.yml`) and releasing (`release.yml`) are run by maintainers by hand;
see `docs/releasing.md` and `docs/macos-signing.md`.
