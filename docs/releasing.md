# Releasing a version

Releasing has two separate steps. **Package** builds release candidates, as often as needed.
**Release** promotes one candidate, once someone has tested it. What reaches poets is
byte-for-byte what was tested.

## Where the version lives

**`release/app/package.json` is the version.** electron-builder reads the version from there,
because the project uses its two-`package.json` layout. That covers:

- the installer file names, such as `Midst-0.1.0-arm64.pkg`;
- the macOS bundle version;
- the Windows file version.

The root `package.json` and both lock files record the same number. Nobody edits any of the six by
hand:

```bash
tools/set_version.sh 0.2.0
```

That sets all six places, then runs `tools/check_version.sh`. The same check runs in pre-commit and
in CI, so a commit where they disagree cannot pass the gates.

**About Midst** (the Midst menu on a Mac, Help elsewhere) shows that version as its release tag, with
the commit the package was built from and that commit's date, for example
`Version v0.2.1, commit a1b2c3d, committed 2026-10-13 20:30 UTC`. The commit is read from git when the
main bundle is built (`.erb/scripts/build-identity.js`) and ends in `-dirty` if tracked files had
uncommitted changes. Running from source shows `Development build`.

Separately, `midstVersion` in `src/main/util.ts` is the version of the poem **file format**. It
changes only when the format does, never with a release.

## Making a release

1. **Bump the version and write the notes** on a branch.
   - Run `tools/set_version.sh <new version>`. Use MAJOR.MINOR.PATCH: **patch** for fixes,
     **minor** for new features or anything that changes what poets see, **major** for a change to
     the file format that older versions cannot read.
   - Add the version's entry to `CHANGELOG.md` under a `# <version>` heading. That entry becomes
     the release notes, and the release is refused without it.
2. **Merge it** to `main` through a pull request.
3. **Build a candidate**: **Actions → package → Run workflow**, with the branch `main` and the
   platform `all`.
   - The run's summary shows the version, whether macOS was signed and notarised, and each
     installer's file name.
   - The installers are under the run's **Artifacts**.
4. **Test the candidate.** Download the artifacts, install them, and try them. For macOS, do the
   three checks in [The macOS install test](#the-macos-install-test) below; **step 5 does not happen
   until all three have passed on this candidate's package**. If something is wrong, fix it on a
   branch and merge it. Then build a new candidate from `main` at the same version, because nothing
   has been released yet, and test that one from the start.
5. **Release the candidate that passed**: **Actions → release → Run workflow**, giving it that
   package run's number (the number at the end of the run's URL). The field can be left blank: it
   then takes the latest successful package run on `main`, and refuses if another package run on
   `main` at the same version still has artifacts, since only you know which one you tested. Either
   way, the run's summary starts with the run it chose, its commit, version and build time. It:
   - checks the candidate;
   - tags its commit `v<version>`;
   - publishes a GitHub Release named `Midst <version>`, with the three installers, a
     `SHA256SUMS` file, and the changelog entry as its notes.
   - checks the release carries every installer at its size and SHA-256, then deletes the Actions artifacts
     of that package run and of every earlier package run (never a newer one, which may be a
     candidate under test). GitHub Free holds only 500 MB of artifacts, about two package runs;
     release assets have no limit. The run's summary lists what was deleted. To see the list
     without deleting anything: `node tools/prune_artifacts.cjs prune --repo <owner/name> --run <id> --dry-run`.

Artifacts are deleted after the repository's retention period (90 days by default), so release a
candidate before then, or build a new one.

## The macOS install test

Every macOS package gets these three checks before it is released. They exist because 0.2.0's first
candidate reported "The installation was successful" and put nothing in Applications.

**No `v<version>` tag is made until the script has passed and both manual steps are ticked, all on
the package being released.** Nothing enforces this but the person running the release workflow.

Use a Mac, or an account on one, that has no Midst installed.

- [ ] **The script passes.** Anyone can run it; it needs no administrator password.

  ```bash
  gh run download <package run number> -R midst-press/midst-editor -p 'midst-macos-*' -D candidate
  tools/check_installed_package.sh candidate/midst-macos-*/Midst-*-arm64.pkg
  ```

  It checks the package (signed, accepted by Gatekeeper, not relocatable, the right version),
  installs it "for me only", confirms an older copy elsewhere on the Mac was left alone, launches the
  app, opens a made-up poem, quits, and removes everything it installed. It prints one line per step
  and ends `PASSED` (exit 0). `FAILED` (exit 1) means do not release. `CANNOT RUN` (exit 2) means it
  proved nothing, most often because a Midst is already installed there; it will not touch one.
  Midst's window appears for a few seconds while it runs.

- [ ] **An "all users" install puts Midst in the main Applications folder.** This needs an
      administrator password, and it is the path that failed for a poet. Double-click the package,
      choose **Install for all users of this computer**, and finish. Then look for:

  - `Midst` in `/Applications` (Finder: Go → Applications), not only in your home folder;
  - **Get Info** on it shows the version being released;
  - it opens from there.

  If the installer says it succeeded and Midst is not in `/Applications`, do not release.

- [ ] **The installer's windows read correctly.** While doing the step above, read each window:

  - no warning that the package cannot be verified or is from an unidentified developer;
  - the installer names the package `Midst <version>`, with the version being released. That name is
    the only place the installer shows a version; it has no separate title or version line. For the
    version of what was installed, use **Get Info** on the app, as in the step above;
  - the destination window offers the choices you expect, and choosing **Install for me only**
    instead (run the package a second time) puts Midst in `~/Applications`.

  The script cannot see these windows: the command line skips them.

Afterwards, delete the copies you installed by hand (`/Applications/Midst.app` and
`~/Applications/Midst.app`), so the next candidate's test starts clean.

## What the release workflow refuses

It checks all of this before it tags or publishes anything:

| It refuses a run that...                                                           | Why                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------- |
| is not a successful **package** run started from `main`                            | only reviewed, merged code is released   |
| lacks build information for macOS, Windows and Linux, or mixes versions or commits | one release is one build of one commit   |
| has a macOS installer that was not signed **and** notarised                        | poets would get a Gatekeeper warning     |
| has an installer whose SHA-256 differs from what its build recorded                | what is released must be what was tested |
| is for a version already tagged or released from a different commit                | one version, one build                   |
| has no `CHANGELOG.md` entry for its version                                        | every release says what changed          |

The package workflow also refuses to build a candidate from `main` once that version has been
released from different code. Bump the version first.

Runs from other branches still build, so changes can be tried before they merge. They can never be
released.

## Publishing somewhere else

Releases go to this repository by default. Only people with access to the repository can download
them while it is private.

To publish to another repository instead, such as a public downloads repository:

1. Set the repository **variable** `RELEASE_REPOSITORY` to `owner/name`.
2. Set the repository **secret** `RELEASE_TOKEN` to a token that can create releases there, for
   example a fine-grained personal access token with **Contents: Read and write** on that
   repository only.

The `v<version>` tag is still made here, on the commit that was built. This path has not been used
yet, so check the first release made with it.
