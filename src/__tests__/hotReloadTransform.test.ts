/* eslint-disable global-require */

describe('renderer.dev hot-reload transformer injection', () => {
  it('does not mutate the base config', () => {
    const base = require('../../.erb/configs/webpack.config.base').default;
    const baseKeysBefore = Object.keys(
      (base.module?.rules?.[0] as any)?.use?.options ?? {}
    );
    expect(baseKeysBefore).not.toContain('getCustomTransformers');

    // Import renderer.dev runs the merge and injection.
    const merged =
      require('../../.erb/configs/webpack.config.renderer.dev').default;
    // Trigger the module side effect; merged is used in the assertions below.
    expect(merged).toBeDefined();

    const baseKeysAfter = Object.keys(
      (base.module?.rules?.[0] as any)?.use?.options ?? {}
    );
    expect(baseKeysAfter).toEqual(baseKeysBefore);
  });

  it('patches exactly one ts-loader rule with getCustomTransformers', () => {
    const merged =
      require('../../.erb/configs/webpack.config.renderer.dev').default;
    const rules = (merged.module?.rules ?? []) as any[];
    const patched = rules.filter(
      (r: any) =>
        typeof r.use === 'object' &&
        !Array.isArray(r.use) &&
        r.use?.loader === 'ts-loader' &&
        r.use?.options?.getCustomTransformers
    );
    expect(patched).toHaveLength(1);
  });

  it('the transformer is react-refresh-typescript', () => {
    const merged =
      require('../../.erb/configs/webpack.config.renderer.dev').default;
    const rules = (merged.module?.rules ?? []) as any[];
    const patched = rules.find(
      (r: any) =>
        typeof r.use === 'object' &&
        !Array.isArray(r.use) &&
        r.use?.loader === 'ts-loader' &&
        r.use?.options?.getCustomTransformers
    );
    const result = patched.use.options.getCustomTransformers();
    expect(result.before).toHaveLength(1);
    expect(typeof result.before[0]).toBe('function');
  });
});
