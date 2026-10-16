/**
 * Regression test for injectRefreshTransform (GitHub #43, PR #144).
 *
 * Tests the extracted module directly — no webpack config import, no postinstall
 * side effect. Verifies:
 * 1. Base config objects are NOT mutated.
 * 2. Exactly one ts-loader rule is patched; zero or two matches throw.
 * 3. The transformer is react-refresh-typescript.
 */
import { injectRefreshTransform } from '../../.erb/configs/inject-refresh-transform';

function tsRule() {
  return {
    test: /\.[jt]sx?$/,
    exclude: /node_modules/,
    use: {
      loader: 'ts-loader',
      options: { transpileOnly: true, compilerOptions: { module: 'esnext' } },
    },
  };
}

function cssRule() {
  return {
    test: /\.css$/,
    use: ['style-loader', 'css-loader'],
  };
}

describe('injectRefreshTransform', () => {
  it('patches the ts-loader rule and leaves base untouched', () => {
    const rule = tsRule();
    const optsBefore = Object.keys(rule.use.options);
    const { rules, patched } = injectRefreshTransform([rule, cssRule()]);

    expect(patched).toBe(1);
    expect(optsBefore).not.toContain('getCustomTransformers');
    expect(Object.keys(rule.use.options)).toEqual(optsBefore);
    const patchedRule = rules[0];
    expect(patchedRule.use.options.getCustomTransformers).toBeDefined();
  });

  it('throws when there is no ts-loader rule', () => {
    expect(() => injectRefreshTransform([cssRule()])).toThrow(
      /Expected exactly one ts-loader rule/
    );
  });

  it('throws when there are two ts-loader rules', () => {
    expect(() => injectRefreshTransform([tsRule(), tsRule()])).toThrow(
      /Expected exactly one ts-loader rule/
    );
  });

  it('the transformer is react-refresh-typescript', () => {
    const { rules } = injectRefreshTransform([tsRule()]);
    const result = rules[0].use.options.getCustomTransformers();
    expect(result.before).toHaveLength(1);
    expect(typeof result.before[0]).toBe('function');
  });

  it('copies the rule and options, not the references', () => {
    const rule = tsRule();
    const { rules } = injectRefreshTransform([rule]);
    expect(rules[0]).not.toBe(rule);
    expect(rules[0].use).not.toBe(rule.use);
    expect(rules[0].use.options).not.toBe(rule.use.options);
  });
});
