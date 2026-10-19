#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax -- a Node CLI that prints its report, over plain loops */
// Finds words written straight into the main process's menus and dialogs, which belong in the message
// catalog (midst-infra docs/design/message-catalog.md, section 7). The renderer is checked by ESLint's
// lingui rule; Electron's menu templates and dialog options are plain objects, which that rule cannot
// tell apart from any other object, so this check reads them by property name.
//
//   node tools/check-main-strings.mjs [--root <dir>] [--report-only] [files...]
//
// A finding is a property named for words a person sees (label, sublabel, toolTip, title, message, detail,
// buttons, checkboxLabel, buttonLabel, nameFieldLabel, and `name` inside a dialog's `filters`) whose value
// is written out: a string, a template, or an array or conditional holding one. So is an argument written
// out to a `dialog.*` call (`dialog.showErrorBox(title, content)` takes its words positionally) or to a
// window's setTitle or setRepresentedFilename, which macOS shows in the title bar. A catalog call such as
// i18n._('menu.file.save') is not a finding, and neither is anything computed elsewhere.
//
// Scans src/main/**/*.ts except tests, or the files given. Prints file:line and the property, never the
// words. Exit: 0 none (or --report-only); 1 findings; 2 usage or an unreadable file.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const WORD_PROPERTIES = new Set([
  'label',
  'sublabel',
  'toolTip',
  'title',
  'message',
  'detail',
  'buttons',
  'checkboxLabel',
  'buttonLabel',
  'nameFieldLabel',
]);

function usage(message) {
  console.error(`check-main-strings: ${message}`);
  console.error(
    'usage: node tools/check-main-strings.mjs [--root <dir>] [--report-only] [files...]'
  );
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    root: join(dirname(fileURLToPath(import.meta.url)), '..'),
    reportOnly: false,
    files: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--report-only') opts.reportOnly = true;
    else if (arg === '--root') {
      if (i + 1 >= argv.length) usage('--root needs a directory');
      i += 1;
      opts.root = argv[i];
    } else if (arg.startsWith('--')) usage(`unknown argument ${arg}`);
    else opts.files.push(arg);
  }
  return opts;
}

function mainSources(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...mainSources(full));
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Whether `node` is words written out, rather than a call or a reference. */
export function isWrittenWords(node) {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
    return isWrittenWords(node.expression);
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  ) {
    return node.getText().length > 2; // '' is not words
  }
  if (ts.isArrayLiteralExpression(node))
    return node.elements.some(isWrittenWords);
  if (ts.isConditionalExpression(node))
    return isWrittenWords(node.whenTrue) || isWrittenWords(node.whenFalse);
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken)
      return isWrittenWords(node.left) || isWrittenWords(node.right);
    if (
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return isWrittenWords(node.right);
    }
  }
  return false;
}

const propertyName = (prop) =>
  prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
    ? prop.name.text
    : undefined;

const WORD_SETTERS = new Set(['setTitle', 'setRepresentedFilename']);

/** `dialog.<name>`, setTitle or setRepresentedFilename, for a call whose arguments are words; else undefined. */
function positionalWordsCallee(call) {
  const fn = call.expression;
  if (!ts.isPropertyAccessExpression(fn)) return undefined;
  const method = fn.name.text;
  if (ts.isIdentifier(fn.expression) && fn.expression.text === 'dialog')
    return `dialog.${method}`;
  return WORD_SETTERS.has(method) ? method : undefined;
}

/** The findings in one file's source, as { line, property }. */
export function findings(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true
  );
  const found = [];
  const at = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node, inFilters) => {
    const callee = ts.isCallExpression(node)
      ? positionalWordsCallee(node)
      : undefined;
    if (callee) {
      node.arguments.forEach((arg, i) => {
        if (isWrittenWords(arg)) {
          found.push({
            line: at(arg),
            property: `${callee} argument ${i + 1}`,
          });
        }
      });
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node);
      const words = WORD_PROPERTIES.has(name) || (inFilters && name === 'name');
      if (words && isWrittenWords(node.initializer)) {
        const { line } = source.getLineAndCharacterOfPosition(
          node.getStart(source)
        );
        found.push({ line: line + 1, property: name });
      }
      ts.forEachChild(node, (child) =>
        visit(child, name === 'filters' || inFilters)
      );
      return;
    }
    ts.forEachChild(node, (child) => visit(child, inFilters));
  };
  visit(source, false);
  return found;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = opts.files.length
    ? opts.files.map((f) => join(opts.root, f))
    : mainSources(join(opts.root, 'src', 'main'));
  let total = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      console.error(
        `check-main-strings: cannot read ${file}: ${error.message}`
      );
      process.exit(2);
    }
    for (const { line, property } of findings(file, text)) {
      console.log(
        `${relative(
          opts.root,
          file
        )}:${line}: ${property} is written out; it belongs in the catalog.`
      );
      total += 1;
    }
  }
  console.log(
    `Main-process words outside the catalog: ${total}${
      total && opts.reportOnly ? ' (report only, not failing)' : ''
    }`
  );
  if (total && !opts.reportOnly) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
