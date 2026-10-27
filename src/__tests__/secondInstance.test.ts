import poemIn, { poemFromData } from '../main/secondInstance';

// The poem in a second launch's command line (#315).
describe('poemIn', () => {
  it('finds the .midst file among the arguments, whatever its case', () => {
    expect(poemIn(['/zq/Midst.exe', 'C:\\zq\\xv.MIDST'])).toBe(
      'C:\\zq\\xv.MIDST'
    );
    expect(poemIn(['/zq/midst', '--zq', '/a/b c.midst'])).toBe('/a/b c.midst');
  });

  it('takes the last one when there are several', () => {
    expect(poemIn(['/zq/midst', '/a/one.midst', '/a/two.midst'])).toBe(
      '/a/two.midst'
    );
  });

  it('is empty when there is none, and never takes a switch', () => {
    expect(poemIn(['/zq/midst'])).toBe('');
    expect(poemIn(['/zq/midst', '--file=/a/zq.midst', '/a/zq.txt'])).toBe('');
    expect(poemIn([])).toBe('');
  });
});

// The poem a second launch sends as its lock request's data (#336).
describe('poemFromData', () => {
  it('takes a .midst path from { poem }', () => {
    expect(poemFromData({ poem: '/a/zq.midst' })).toBe('/a/zq.midst');
  });

  it('is empty for anything else', () => {
    [
      undefined,
      null,
      {},
      { poem: '' },
      { poem: '/a/zq.txt' },
      { poem: 3 },
      'zq.midst',
    ].forEach((data) => expect(poemFromData(data)).toBe(''));
  });
});
