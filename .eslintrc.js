module.exports = {
  // react-hooks 7's recommended rules (GitHub #44): the classic two that erb already enables, plus the React
  // Compiler team's (purity, refs, immutability, set-state-in-effect, static-components and others).
  extends: ['erb', 'plugin:react-hooks/recommended'],
  rules: {
    // A temporary hack related to IDE not resolving correct package.json
    'import/no-extraneous-dependencies': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/jsx-filename-extension': 'off',
    'import/extensions': 'off',
    'import/no-unresolved': 'off',
    'import/no-import-module-exports': 'off',
  },
  overrides: [
    {
      // `no-undef` is a JavaScript rule and must be off for TypeScript: the compiler already
      // resolves every identifier, and the rule cannot see TYPE-only references, so it reports
      // false positives on things like `NodeJS.Timeout`. typescript-eslint documents this.
      // Scoped to TS files so .js keeps the rule, where it is still useful.
      files: ['**/*.ts', '**/*.tsx'],
      rules: {
        'no-undef': 'off',
      },
    },
    {
      // Words a reader sees or hears belong in the message catalog (midst-infra docs/design/message-catalog.md,
      // section 7). In the renderer they are read with i18n._('key'). The options say what is not words: names
      // the code uses for itself (IPC channels, store keys, CSS classes and variables, routes, reason codes),
      // style values, and log text, which is for us and stays in English. Enforced through the eslint hook, which
      // CI runs on every file. The plugin does not read title, aria-valuetext or aria-description on a DOM
      // element (only on a component); no-restricted-syntax below covers those (#234, #251).
      files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
      excludedFiles: ['src/renderer/**/__tests__/**'],
      plugins: ['lingui'],
      rules: {
        // An override replaces a rule's options rather than adding to them, so airbnb's four entries are repeated.
        'no-restricted-syntax': [
          'error',
          {
            selector: 'ForInStatement',
            message:
              'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.',
          },
          {
            selector: 'ForOfStatement',
            message:
              'iterators/generators require regenerator-runtime, which is too heavyweight for this guide to allow them. Separately, loops should be avoided in favor of array iterations.',
          },
          {
            selector: 'LabeledStatement',
            message:
              'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.',
          },
          {
            selector: 'WithStatement',
            message:
              '`with` is disallowed in strict mode because it makes code impossible to predict and optimize.',
          },
          {
            // Text with a letter anywhere in the value of one of these attributes on a DOM element: plain, braced,
            // in a template, or in a branch of a conditional or fallback. A direct argument of a call is excluded,
            // so the catalog key in title={i18n._('key')} passes.
            selector:
              'JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name=/^(title|aria-valuetext|aria-description)$/] :matches(Literal[value=/\\p{L}/u], TemplateLiteral:has(TemplateElement[value.raw=/\\p{L}/u])):not(CallExpression > *)',
            message:
              'Words a reader sees or hears belong in the message catalog: use i18n._(key) for title, aria-valuetext and aria-description.',
          },
        ],
        'lingui/no-unlocalized-strings': [
          'error',
          {
            useTsTypes: true,
            ignore: [
              // kebab-case and CSS custom properties: classes, ids, channels, store keys, reason codes
              '^-{0,2}[a-z0-9]+(-[a-z0-9]*)+$',
              // a CSS var() reference
              '^var\\(',
              // CSS lengths
              '^-?[0-9.]+(px|rem|em|%)$',
            ],
            ignoreFunctions: [
              'window.electron.store.*',
              'window.electron.ipcRenderer.*',
              'window.electron.log.*',
              'window.sessionStorage.*',
              'store.*',
              'log.*',
              'logger.*',
              'navigate',
              'cssVar',
              'useMediaQuery',
              'format',
              'document.*',
              'window.document.*',
              '*.addEventListener',
              '*.removeEventListener',
              '*.closest',
              '*.parseFromString',
              'editor.on',
              'editor.off',
              '*.classList.*',
              // an editing command's name
              '*.execCommand',
              'PluginKey',
              'Error',
              'RestartFromError',
              // useDraftMarkers: the name of the change, for the log
              'apply',
              'refuse',
            ],
            ignoreNames: [
              'className',
              'class',
              'classes',
              'name',
              'type',
              'size',
              'fontSize',
              'placement',
              'component',
              'anchor',
              'valueLabelDisplay',
              'sx',
              'palette',
              'typography',
              'path',
              'to',
              { regex: { pattern: '_(LOG|CLASS|KEY)$' } },
              'RETURN_TO',
            ],
          },
        ],
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    // Lint-only project: see tsconfig.eslint.json for why the build config cannot serve here.
    project: './tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
    createDefaultProgram: true,
  },
  settings: {
    'import/resolver': {
      // See https://github.com/benmosher/eslint-plugin-import/issues/1396#issuecomment-575727774 for line below
      node: {},
      webpack: {
        config: require.resolve('./.erb/configs/webpack.config.eslint.ts'),
      },
      typescript: {},
    },
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
  },
};
