import { render } from '@testing-library/react';
import { useContext, useEffect } from 'react';
import { HistoryContext, TextContext } from '../renderer/context';

// A consumer rendered without its Provider must fail loudly, not drop the poem's text or history (#253).
function SetsText() {
  const { setText } = useContext(TextContext);
  useEffect(() => setText('zq'), [setText]);
  return null;
}
function SetsHistory() {
  const { setPoemHistory } = useContext(HistoryContext);
  useEffect(() => setPoemHistory([]), [setPoemHistory]);
  return null;
}

describe('the contexts outside their Providers', () => {
  beforeEach(() =>
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  );
  afterEach(() => jest.restoreAllMocks());

  it('setText throws', () => {
    expect(() => render(<SetsText />)).toThrow(
      'TextContext used outside its Provider'
    );
  });

  it('setPoemHistory throws', () => {
    expect(() => render(<SetsHistory />)).toThrow(
      'HistoryContext used outside its Provider'
    );
  });

  it('a Provider supplies the setter that runs', () => {
    const setText = jest.fn();
    render(
      <TextContext.Provider value={{ text: '', setText }}>
        <SetsText />
      </TextContext.Provider>
    );
    expect(setText).toHaveBeenCalledWith('zq');
  });
});
