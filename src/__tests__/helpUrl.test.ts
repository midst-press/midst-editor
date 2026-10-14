import { BETA_HELP_URL, RELEASE_HELP_URL, helpUrl } from '../shared/helpUrl';

describe('helpUrl', () => {
  it.each([
    ['0.3.0', BETA_HELP_URL],
    ['0.99.99', BETA_HELP_URL],
    ['1.0.0-beta.1', BETA_HELP_URL],
    ['1.0.0-rc.1', BETA_HELP_URL],
    ['1.0.0', RELEASE_HELP_URL],
    ['1.0.1', RELEASE_HELP_URL],
    ['2.4.0', RELEASE_HELP_URL],
    ['2.4.0-dev.3', BETA_HELP_URL],
  ])('sends %s to %s', (version, url) => {
    expect(helpUrl(version)).toBe(url);
  });

  it('sends a version it cannot read to the beta site', () => {
    expect(helpUrl('')).toBe(BETA_HELP_URL);
    expect(helpUrl('1.0')).toBe(BETA_HELP_URL);
    expect(helpUrl('v1.0.0')).toBe(BETA_HELP_URL);
  });
});
