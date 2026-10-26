import poemIn from '../main/secondInstance';

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
