/** @jest-environment node */
import dllEntries from '../../.erb/configs/dllEntries';
import { dependencies } from '../../package.json';

// #204: one dependency the DLL build cannot resolve fails the whole build, and with it a plain `npm ci`.
// CI installs with --ignore-scripts and never builds the DLL, so this is the check that it would.
describe('the development renderer DLL', () => {
  it('takes only dependencies that resolve as a package root', () => {
    const entries = dllEntries(dependencies);
    // Positive control: the list is the real dependency list, not empty.
    expect(entries.length).toBeGreaterThan(5);
    const unresolvable = entries.filter((name) => {
      try {
        require.resolve(name);
        return false;
      } catch {
        return true;
      }
    });
    expect(unresolvable).toEqual([]);
  });

  it('leaves out TipTap and the vendored format library', () => {
    const entries = dllEntries({
      react: '1',
      '@tiptap/core': '1',
      '@midst-press/midst-format': 'file:vendor/midst-format',
    });
    expect(entries).toEqual(['react']);
  });

  it('the vendored format library does not resolve as a root, which is why it is left out', () => {
    expect(() => require.resolve('@midst-press/midst-format')).toThrow();
  });
});
