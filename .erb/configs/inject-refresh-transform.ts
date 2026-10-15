/**
 * Patch a webpack rules array: inject react-refresh-typescript into the ts-loader rule.
 *
 * Builds a NEW rules array with COPIED rule and COPIED options — the caller's own
 * config objects are never written. Throws unless exactly one ts-loader rule is found.
 */
import reactRefreshTypescript from 'react-refresh-typescript';

export function injectRefreshTransform(rules: any[]): {
  rules: any[];
  patched: number;
} {
  let patched = 0;
  const patchedRules = rules.map((rule) => {
    const { use } = rule;
    const loaderName =
      typeof use === 'object' && !Array.isArray(use) ? use?.loader : undefined;
    if (loaderName === 'ts-loader' && use?.options) {
      patched += 1;
      return {
        ...rule,
        use: {
          ...use,
          options: {
            ...use.options,
            getCustomTransformers: () => ({
              before: [reactRefreshTypescript()],
            }),
          },
        },
      };
    }
    return rule;
  });
  if (patched !== 1) {
    throw new Error(
      `Expected exactly one ts-loader rule to patch, found ${patched}. ` +
        'The base config may have changed shape — update webpack.config.renderer.dev.ts.'
    );
  }
  return { rules: patchedRules, patched };
}

export default injectRefreshTransform;
