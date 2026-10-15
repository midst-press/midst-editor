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
