# Releasing a version

One version number, set in one command, carried by the installers, and tagged in git when the
macOS installer is signed and notarised.

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

Separately, `midstVersion` in `src/main/util.ts` is the version of the poem **file format**. It
changes only when the format does, never with a release.

## Making a release

1. **Bump the version** on a branch: `tools/set_version.sh <new version>`, then add the release's
   entry to `CHANGELOG.md`. Use MAJOR.MINOR.PATCH:
   - **patch** for fixes;
   - **minor** for new features, or anything that changes what poets see;
   - **major** for a change to the file format that older versions cannot read.
2. **Merge it** to `main` through a pull request.
3. **Build it** from `main`: **Actions → package → Run workflow**, with the branch `main` and the
   platform `all`.
4. **Check the run.**
   - Its summary shows the version, and each installer's file name carries it.
   - When the macOS installer is signed and notarised, the `tag` job tags the commit `v<version>`.
     The tag's message links to the run that built it.

The installers are the run's **Artifacts**.

## What the workflow refuses

- **A run from `main` whose version is already tagged on a different commit.** It stops at the
  `plan` job, before anything is built. Two different installers can never carry the same version.
  Bump the version and merge first.
- **Re-running a release commit is allowed:** the same commit already holds the tag, so nothing is
  re-tagged.
- **Runs from other branches** build, so they can be tested, but they are never tagged.
- **An unsigned macOS build** (no signing secrets) is never tagged. See
  [macos-signing.md](macos-signing.md).
