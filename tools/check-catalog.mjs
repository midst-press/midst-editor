#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax, no-continue -- a Node CLI that prints its report, over plain loops */
// Checks the message catalog (midst-infra docs/design/message-catalog.md, section 7).
//
//   node tools/check-catalog.mjs [--root <dir>] [--report-only] [--fix]
//
// Problems, each failing the check:
//   - a locales/<lang> folder that lingui.config.js does not list, or a listed locale with no messages.po;
//   - an English entry with no English: empty, or the id itself, which is what `lingui extract` writes for a
//     key the code uses and the catalog has no words for yet;
//   - an obsolete English entry (`#~`), which is a key no code uses any more;
//   - a message that does not parse as ICU MessageFormat;
//   - a translation of a key English does not have, or whose placeholders differ from the English;
//   - a translation, not marked draft, whose recorded English (its `# en:` comment) is not the English now;
//   - a translated document with no English document of the same name.
//
// Reports, never failures: the drafts (entries marked `#, fuzzy`, documents with `status: draft` in
// their front matter), which are the journal's editor's review list; and, per language, keys with no
// translation yet, which show in English.
//
// A translation records the English it was made from as `# en: <the English as a JSON string>`. It is a
// `#` comment, not `#.`, because `lingui extract` rewrites `#.` comments and would drop it. --fix marks
// each translation whose recorded English is out of date as draft, and records the current English.
//
// --report-only prints the problems but exits 0 (the catalog's first PR, before anything depends on it).
// Prints ids and counts, never message text. Exit: 0 clean (or --report-only); 1 problems; 2 usage or an
// unreadable input.

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PO = require('pofile');
const { parse: parseIcu } = require('@messageformat/parser');

const EN_COMMENT = /^en: (.*)$/;

function usage(message) {
  console.error(`check-catalog: ${message}`);
  console.error(
    'usage: node tools/check-catalog.mjs [--root <dir>] [--report-only] [--fix]'
  );
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    root: join(dirname(fileURLToPath(import.meta.url)), '..'),
    reportOnly: false,
    fix: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--report-only') opts.reportOnly = true;
    else if (arg === '--fix') opts.fix = true;
    else if (arg === '--root') {
      if (i + 1 >= argv.length) usage('--root needs a directory');
      i += 1;
      opts.root = argv[i];
    } else usage(`unknown argument ${arg}`);
  }
  return opts;
}

/** The names of every placeholder in an ICU message, including those inside plural and select cases. */
function placeholders(tokens, into = new Set()) {
  for (const token of tokens) {
    if (token.arg !== undefined) into.add(token.arg);
    for (const c of token.cases ?? []) placeholders(c.tokens, into);
  }
  return into;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const show = (set) => (set.size ? [...set].sort().join(', ') : 'none');

/** The recorded English of a translated entry, or undefined when it has none or it is unreadable. */
function recordedEnglish(item) {
  for (const comment of item.comments) {
    const m = EN_COMMENT.exec(comment);
    if (!m) continue;
    try {
      const value = JSON.parse(m[1]);
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Whether a Markdown document's front matter says `status: draft`. */
function isDraftDocument(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  return Boolean(m && /^status:\s*draft\s*$/m.test(m[1]));
}

/**
 * Rewrite one PO file's text so each id in `stale` is marked fuzzy and records `english[id]`. Edits lines
 * in place rather than reserialising, so the file keeps the layout `lingui extract` gives it.
 */
function applyFix(text, stale, english) {
  const blocks = text.split(/\n\n/);
  return blocks
    .map((block) => {
      const lines = block.split('\n');
      const idLine = lines.find((l) => l.startsWith('msgid "'));
      if (!idLine) return block;
      const id = JSON.parse(idLine.slice('msgid '.length));
      if (!stale.has(id)) return block;
      const recorded = `# en: ${JSON.stringify(english.get(id))}`;
      let out = lines.filter((l) => !/^# en: /.test(l));
      const flagAt = out.findIndex((l) => l.startsWith('#, '));
      if (flagAt === -1) {
        out.splice(out.indexOf(idLine), 0, '#, fuzzy');
      } else if (!/\bfuzzy\b/.test(out[flagAt])) {
        out[flagAt] = `${out[flagAt]}, fuzzy`;
      }
      out = [recorded, ...out];
      return out.join('\n');
    })
    .join('\n\n');
}

function readCatalog(file) {
  try {
    return PO.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`check-catalog: cannot read ${file}: ${error.message}`);
    process.exit(2);
  }
  return undefined;
}

function report(problems, drafts, untranslated, opts) {
  console.log(`Drafts awaiting review: ${drafts.length}`);
  for (const d of drafts) console.log(`  ${d}`);
  for (const [locale, ids] of untranslated) {
    console.log(
      `Not yet translated into ${locale} (shown in English): ${ids.length}`
    );
    for (const id of ids) console.log(`  ${id}`);
  }
  if (problems.length === 0) {
    console.log('Catalog: no problems.');
    return;
  }
  console.log(
    `Catalog problems: ${problems.length}${
      opts.reportOnly ? ' (report only, not failing)' : ''
    }`
  );
  for (const p of problems) console.log(`  ${p}`);
  if (!opts.reportOnly) process.exitCode = 1;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const configFile = join(opts.root, 'lingui.config.js');
  if (!existsSync(configFile)) usage(`no lingui.config.js in ${opts.root}`);
  // eslint-disable-next-line import/no-dynamic-require -- the config of the --root being checked
  const config = require(configFile);
  const source = config.sourceLocale;
  const locales = [...config.locales];
  const localesDir = join(opts.root, 'locales');
  const at = (...parts) => relative(opts.root, join(localesDir, ...parts));

  const problems = [];
  const drafts = [];
  const untranslated = new Map();

  const folders = existsSync(localesDir)
    ? readdirSync(localesDir).filter((name) =>
        statSync(join(localesDir, name)).isDirectory()
      )
    : [];
  for (const folder of folders.sort()) {
    if (!locales.includes(folder))
      problems.push(`${at(folder)}/ is not a locale lingui.config.js lists.`);
  }
  for (const locale of locales) {
    if (!existsSync(join(localesDir, locale, 'messages.po')))
      problems.push(`${at(locale, 'messages.po')} is missing.`);
  }
  if (
    !locales.includes(source) ||
    !existsSync(join(localesDir, source, 'messages.po'))
  ) {
    report(problems, drafts, untranslated, opts);
    return;
  }

  const checkIcu = (file, id, text) => {
    try {
      return placeholders(parseIcu(text));
    } catch (error) {
      problems.push(
        `${file}: ${id} is not valid ICU MessageFormat (${
          error.message.split('\n')[0]
        }).`
      );
      return undefined;
    }
  };

  // English: complete, the source.
  const enFile = at(source, 'messages.po');
  const english = new Map();
  const englishPlaceholders = new Map();
  const englishIds = new Set();
  for (const item of readCatalog(join(localesDir, source, 'messages.po'))
    .items) {
    if (!item.obsolete) englishIds.add(item.msgid);
    if (item.obsolete) {
      problems.push(
        `${enFile}: ${item.msgid} is no longer used by any code (obsolete).`
      );
      continue;
    }
    const text = item.msgstr.join('');
    if (text === '' || text === item.msgid) {
      problems.push(`${enFile}: ${item.msgid} has no English.`);
      continue;
    }
    english.set(item.msgid, text);
    if (item.flags.fuzzy) drafts.push(`${enFile}: ${item.msgid}`);
    const names = checkIcu(enFile, item.msgid, text);
    if (names) englishPlaceholders.set(item.msgid, names);
  }

  // Every other language: may be partial.
  for (const locale of locales.filter((l) => l !== source)) {
    const poPath = join(localesDir, locale, 'messages.po');
    if (!existsSync(poPath)) continue;
    const file = at(locale, 'messages.po');
    const translated = new Set();
    const stale = new Set();
    for (const item of readCatalog(poPath).items) {
      if (item.obsolete) continue;
      if (!englishIds.has(item.msgid)) {
        problems.push(`${file}: ${item.msgid} is not an English key.`);
        continue;
      }
      // A key whose English is missing is reported once, against English.
      if (!english.has(item.msgid)) continue;
      const text = item.msgstr.join('');
      if (text === '') continue;
      translated.add(item.msgid);
      if (item.flags.fuzzy) drafts.push(`${file}: ${item.msgid}`);
      const names = checkIcu(file, item.msgid, text);
      const want = englishPlaceholders.get(item.msgid);
      if (names && want && !sameSet(names, want)) {
        problems.push(
          `${file}: ${item.msgid} has placeholders ${show(
            names
          )}; the English has ${show(want)}.`
        );
      }
      const recorded = recordedEnglish(item);
      if (recorded !== english.get(item.msgid)) {
        if (opts.fix) stale.add(item.msgid);
        else if (!item.flags.fuzzy) {
          problems.push(
            `${file}: ${item.msgid} was translated from English that has changed, or records none; run --fix to mark it draft.`
          );
        }
      }
    }
    const missing = [...english.keys()]
      .filter((id) => !translated.has(id))
      .sort();
    if (missing.length) untranslated.set(locale, missing);
    if (opts.fix && stale.size) {
      writeFileSync(
        poPath,
        applyFix(readFileSync(poPath, 'utf8'), stale, english)
      );
      console.log(
        `${file}: marked ${stale.size} out-of-date translation(s) draft.`
      );
    }
  }

  // Documents.
  const docsOf = (locale) => {
    const dir = join(localesDir, locale, 'docs');
    return existsSync(dir)
      ? readdirSync(dir).filter((n) => n.endsWith('.md'))
      : [];
  };
  const englishDocs = new Set(docsOf(source));
  for (const locale of locales) {
    for (const name of docsOf(locale).sort()) {
      if (locale !== source && !englishDocs.has(name)) {
        problems.push(
          `${at(
            locale,
            'docs',
            name
          )} has no English document of the same name.`
        );
      }
      if (
        isDraftDocument(
          readFileSync(join(localesDir, locale, 'docs', name), 'utf8')
        )
      ) {
        drafts.push(at(locale, 'docs', name));
      }
    }
  }

  report(problems, drafts, untranslated, opts);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
