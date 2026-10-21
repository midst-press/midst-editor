#!/usr/bin/env node
// content/ is Annelyse's (#281): she edits it on GitHub, and her edits come back to Gitea through the return path,
// a pull request from github-main (midst-infra tools/return_path.sh). Nothing else may change it.
//
//   node tools/check-content-owner.mjs --staged                         the commit being made (pre-commit)
//   node tools/check-content-owner.mjs --range <base> <head> <head-ref> a pull request (CI)
//
// --staged: the index's content/ must equal HEAD's, or MERGE_HEAD's while a merge is being committed (a merge of
// main that brings her text in), or origin/main's at some commit since this branch's merge base with it (putting
// her text back after a commit that changed it). --range: the head's content/ must equal content/ at some commit of <base>'s
// first-parent history back to the merge base, so a branch that merged main in passes. A head ref of github-main
// passes: that is the return path. While HEAD (or <base>) has no content/ at all, anything passes: the change that
// creates the folder. In a clone where midst.contentOwner is true (hers), --staged passes everything.
//
// This is for the honest mistake, not a deliberate bypass (Stuart, #281). Only a push allowlist on github-main
// keeps someone from naming a branch that.
//
// Exit: 0 allowed   1 refused   3 could not tell (a git command failed, or bad arguments)

import { spawnSync } from 'node:child_process'
import { isMain } from './is-main.mjs'

export const RETURN_PATH_BRANCH = 'github-main'
const MAIN_REF = 'origin/main'
const ABSENT = 'absent'

const REFUSAL =
  'content/ is Annelyse\'s: she edits it on GitHub, and it comes back to Gitea through the return path ' +
  '(a pull request from github-main). Take your change to content/ out of this commit. See content/README.md.'

class GitError extends Error {}

function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.error) throw new GitError(`git ${args.join(' ')}: ${r.error.message}`)
  if (r.status !== 0) {
    if (allowFail) return null
    throw new GitError(`git ${args.join(' ')} exited ${r.status}: ${r.stderr.trim()}`)
  }
  return r.stdout.trim()
}

/** The tree id of content/ at `rev`, or "absent". A rev that does not exist is an error, not an absent folder. */
export function contentTree(cwd, rev) {
  git(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])
  return git(cwd, ['rev-parse', '--verify', '--quiet', `${rev}:content`], { allowFail: true }) || ABSENT
}

/** The tree id of content/ in the index, or "absent". */
export function stagedContentTree(cwd) {
  if (git(cwd, ['ls-files', '--cached', '--', 'content/']) === '') return ABSENT
  return git(cwd, ['write-tree', '--prefix=content/'])
}

/** Whether the commit being made may have the content/ it has. */
export function stagedAllowed(cwd) {
  const head = git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { allowFail: true })
  if (!head) return true // the first commit of a repository
  // Her own clone: she says so once, with `git config midst.contentOwner true` (content/README.md).
  if (git(cwd, ['config', '--get', '--type=bool', 'midst.contentOwner'], { allowFail: true }) === 'true') return true
  const ok = [contentTree(cwd, 'HEAD')]
  if (ok[0] === ABSENT) return true
  if (git(cwd, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { allowFail: true })) ok.push(contentTree(cwd, 'MERGE_HEAD'))
  // Main's content/ since this branch left it, as --range allows: so putting her text back after a commit that
  // changed it is never refused. Only where this clone has origin/main.
  if (git(cwd, ['rev-parse', '--verify', '--quiet', `${MAIN_REF}^{commit}`], { allowFail: true })) ok.push(...mainTrees(cwd, MAIN_REF, 'HEAD'))
  return ok.includes(stagedContentTree(cwd))
}

/** content/ at each commit of `base`'s first-parent history back to its merge base with `head`, inclusive. */
function mainTrees(cwd, base, head) {
  const mergeBase = git(cwd, ['merge-base', base, head])
  const history = git(cwd, ['rev-list', '--first-parent', `${mergeBase}..${base}`]).split('\n').filter(Boolean)
  return [...history, mergeBase].map(rev => contentTree(cwd, rev))
}

/** Whether a pull request from `headRef` at `head` into `base` may have the content/ it has. */
export function rangeAllowed(cwd, base, head, headRef) {
  if (headRef === RETURN_PATH_BRANCH) return true
  const baseTree = contentTree(cwd, base)
  if (baseTree === ABSENT) return true
  const headTree = contentTree(cwd, head)
  if (headTree === baseTree) return true
  return mainTrees(cwd, base, head).includes(headTree)
}

export function main(argv, cwd = process.cwd()) {
  let allowed
  try {
    if (argv.length === 1 && argv[0] === '--staged') allowed = stagedAllowed(cwd)
    else if (argv.length === 4 && argv[0] === '--range') allowed = rangeAllowed(cwd, argv[1], argv[2], argv[3])
    else {
      console.error('usage: check-content-owner.mjs --staged | --range <base> <head> <head-ref>')
      return 3
    }
  } catch (error) {
    if (!(error instanceof GitError)) throw error
    console.error(`could not tell whether content/ was changed: ${error.message}`)
    return 3
  }
  if (allowed) return 0
  console.error(REFUSAL)
  return 1
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)))
