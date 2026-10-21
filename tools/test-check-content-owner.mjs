// Tests of tools/check-content-owner.mjs (content/ is Annelyse's, #281), on real fixture repositories.
//   node --test tools/test-check-content-owner.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, rangeAllowed, stagedAllowed } from './check-content-owner.mjs'

// The fixtures must not see the repository this test runs in: a commit hook exports GIT_INDEX_FILE and the like.
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]

function repo(t, { content = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'content-owner-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const run = (...args) =>
    execFileSync('git', ['-C', root, '-c', 'user.name=zq', '-c', 'user.email=zq@example.invalid', '-c', 'core.hooksPath=/dev/null', ...args], { stdio: 'pipe' }).toString().trim()
  const write = (path, text) => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const commit = (message, ...paths) => {
    run('add', '-A', '--', ...(paths.length ? paths : ['.']))
    run('commit', '-q', '--no-verify', '--allow-empty', '-m', message)
  }
  run('init', '-q', '-b', 'main')
  write('src/code.ts', 'one\n')
  if (content) write('content/submit.md', 'Her words.\n')
  commit('base')
  return { root, run, write, commit }
}

test('staged: a repository with no commit yet passes', t => {
  const root = mkdtempSync(join(tmpdir(), 'content-owner-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['-C', root, 'init', '-q'])
  assert.equal(stagedAllowed(root), true)
})

test('staged: creating content/ passes while HEAD has none', t => {
  const { root, run, write } = repo(t, { content: false })
  write('content/submit.md', 'Her words.\n')
  run('add', 'content')
  assert.equal(stagedAllowed(root), true)
})

test('staged: a change outside content/ passes', t => {
  const { root, run, write } = repo(t)
  write('src/code.ts', 'two\n')
  run('add', 'src')
  assert.equal(stagedAllowed(root), true)
})

test('staged: changing, adding or deleting under content/ is refused', t => {
  const { root, run, write } = repo(t)
  write('content/submit.md', 'Our words.\n')
  run('add', 'content')
  assert.equal(stagedAllowed(root), false, 'changed')
  run('reset', '-q', '--hard')
  write('content/new.md', 'Our page.\n')
  run('add', 'content')
  assert.equal(stagedAllowed(root), false, 'added')
  run('reset', '-q', '--hard')
  run('rm', '-q', '-r', 'content')
  assert.equal(stagedAllowed(root), false, 'deleted')
})

test("staged: in her own clone (midst.contentOwner true) her change passes", t => {
  const { root, run, write } = repo(t)
  write('content/submit.md', 'Her new words.\n')
  run('add', 'content')
  run('config', 'midst.contentOwner', 'false')
  assert.equal(stagedAllowed(root), false, 'false is not hers')
  run('config', 'midst.contentOwner', 'true')
  assert.equal(stagedAllowed(root), true)
})

test("staged: putting main's content/ back after a commit that changed it passes", t => {
  const { root, run, write, commit } = repo(t)
  run('update-ref', 'refs/remotes/origin/main', 'main')
  run('switch', '-q', '-c', 'work')
  write('content/submit.md', 'Our words.\n')
  commit('oops, made without the hook')
  write('content/submit.md', 'Her words.\n')
  run('add', 'content')
  assert.equal(stagedAllowed(root), true, 'back to main')
  write('content/submit.md', 'Other words.\n')
  run('add', 'content')
  assert.equal(stagedAllowed(root), false, 'neither HEAD nor main')
})

test("staged: without origin/main, only HEAD's content/ passes", t => {
  const { root, run, write, commit } = repo(t)
  run('switch', '-q', '-c', 'work')
  write('content/submit.md', 'Our words.\n')
  commit('oops, made without the hook')
  write('content/submit.md', 'Her words.\n')
  run('add', 'content')
  assert.equal(stagedAllowed(root), false)
})

test('staged: an edit to content/ in the working tree that is not staged passes', t => {
  const { root, write } = repo(t)
  write('content/submit.md', 'Our words.\n')
  assert.equal(stagedAllowed(root), true)
})

test('staged: committing a merge that brings her text in from main passes; anything else under content/ does not', t => {
  const { root, run, write, commit } = repo(t)
  run('switch', '-q', '-c', 'work')
  write('src/code.ts', 'work\n')
  commit('work')
  run('switch', '-q', 'main')
  write('content/submit.md', 'Her new words.\n')
  write('src/code.ts', 'main\n')
  commit('her edit, returned')
  run('switch', '-q', 'work')
  assert.throws(() => run('merge', '-q', 'main')) // src/code.ts conflicts, so the merge is committed by hand
  write('src/code.ts', 'resolved\n')
  run('add', 'src')
  assert.equal(stagedAllowed(root), true, "main's content/")
  write('content/submit.md', 'Our words.\n')
  run('add', 'content')
  assert.equal(stagedAllowed(root), false, 'neither parent')
})

test("range: a pull request that leaves content/ alone passes, even after main has her newer text", t => {
  const { root, run, write, commit } = repo(t)
  run('switch', '-q', '-c', 'work')
  write('src/code.ts', 'work\n')
  commit('work')
  run('switch', '-q', 'main')
  write('content/submit.md', 'Her new words.\n')
  commit('her edit')
  assert.equal(rangeAllowed(root, 'main', 'work', 'work'), true)
})

test('range: a branch that merged main in passes', t => {
  const { root, run, write, commit } = repo(t)
  run('switch', '-q', '-c', 'work')
  write('src/code.ts', 'work\n')
  commit('work')
  run('switch', '-q', 'main')
  write('content/submit.md', 'Her new words.\n')
  commit('her edit')
  run('switch', '-q', 'work')
  run('merge', '-q', '--no-edit', 'main')
  assert.equal(rangeAllowed(root, 'main', 'work', 'work'), true)
})

test('range: a branch that changes, adds or deletes under content/ is refused', t => {
  for (const change of ['changed', 'added', 'deleted']) {
    const { root, run, write, commit } = repo(t)
    run('switch', '-q', '-c', 'work')
    if (change === 'changed') write('content/submit.md', 'Our words.\n')
    if (change === 'added') write('content/new.md', 'Our page.\n')
    if (change === 'deleted') run('rm', '-q', '-r', 'content')
    commit(change)
    assert.equal(rangeAllowed(root, 'main', 'work', 'work'), false, change)
  }
})

test('range: a change to content/ made and undone within the branch passes', t => {
  const { root, run, write, commit } = repo(t)
  run('switch', '-q', '-c', 'work')
  write('content/submit.md', 'Our words.\n')
  commit('oops')
  write('content/submit.md', 'Her words.\n')
  commit('undone')
  assert.equal(rangeAllowed(root, 'main', 'work', 'work'), true)
})

test('range: the return path (head github-main) may change content/', t => {
  const { root, run, write, commit } = repo(t)
  run('switch', '-q', '-c', 'github-main')
  write('content/submit.md', 'Her new words.\n')
  commit('her edit on GitHub')
  assert.equal(rangeAllowed(root, 'main', 'github-main', 'github-main'), true)
  assert.equal(rangeAllowed(root, 'main', 'github-main', 'someone-else'), false, 'the same commits from another branch')
})

test('range: the pull request that creates content/ passes while main has none', t => {
  const { root, run, write, commit } = repo(t, { content: false })
  run('switch', '-q', '-c', 'work')
  write('content/submit.md', 'Her words.\n')
  commit('create content/')
  assert.equal(rangeAllowed(root, 'main', 'work', 'work'), true)
})

test('main: exit 0, 1 with the reason, and 3 when it cannot tell', t => {
  const { root, run, write, commit } = repo(t)
  run('switch', '-q', '-c', 'work')
  const errors = []
  const original = console.error
  console.error = message => errors.push(message)
  try {
    assert.equal(main(['--range', 'main', 'work', 'work'], root), 0)
    write('content/submit.md', 'Our words.\n')
    commit('ours')
    assert.equal(main(['--range', 'main', 'work', 'work'], root), 1)
    assert.match(errors.at(-1), /content\/ is Annelyse's/)
    assert.equal(main(['--range', 'main', 'no-such-branch', 'work'], root), 3)
    assert.match(errors.at(-1), /could not tell/)
    assert.equal(main(['--range', 'main'], root), 3)
    assert.equal(main([], root), 3)
    assert.equal(main(['--staged'], join(root, 'no-such-dir')), 3)
  } finally {
    console.error = original
  }
})
