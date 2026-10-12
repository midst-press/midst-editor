/** @jest-environment node */
import {
  convertMidstFile,
  includeVersionInfo,
  loadDataIntoWorkspace,
  serializeDocument,
} from '../main/util';
import store from '../main/store';

// Synthetic documents only: invented words, never a poem.
jest.mock('electron', () => ({}));
jest.mock('../main/store', () => {
  const values = new Map<string, unknown>();
  return {
    __esModule: true,
    default: {
      get: (k: string) => values.get(k),
      set: (k: string, v: unknown) => values.set(k, v),
    },
  };
});

const window = {
  webContents: { send: jest.fn() },
  setDocumentEdited: jest.fn(),
  setRepresentedFilename: jest.fn(),
} as never;

const oldFile = (meta: Record<string, unknown>) =>
  JSON.stringify({
    editorTimelineFrames: [
      { content: '<p>a</p>', lineNumber: '0', timestamp: 1605903809127 },
      { content: '<p>ab</p>', lineNumber: '0', timestamp: 1605903809227 },
      { content: '<p>abc</p>', lineNumber: '0', timestamp: 1605903809327 },
    ],
    meta,
  });

const B_META = {
  editorFontFamily: 'Garamond',
  editorFontSize: 24,
  editorDraftMarkers: [
    { timelineIndex: 1, name: 'zq first', defaultName: 'Draft 1' },
  ],
  editorHighestEverDraftNumber: 1,
  editorTitle: 'zq title',
  editorAuthor: 'zq author',
};

const saved = () =>
  JSON.parse(
    serializeDocument(
      store.get('poem') as string,
      store.get('history') as string,
      store.get('meta') as string
    )
  );

describe('format C meta (midst-format docs/META.md)', () => {
  it('the converter copies every B presentation field', () => {
    const c = JSON.parse(convertMidstFile(oldFile(B_META)));
    expect(c.meta).toEqual({
      fontFamily: 'Garamond',
      fontSize: 24,
      draftMarkers: [{ index: 1, name: 'zq first', defaultName: 'Draft 1' }],
      highestDraftNumber: 1,
      title: 'zq title',
      author: 'zq author',
    });
    // A marker index is a history index, so there must be one change per B frame.
    expect(c.history).toHaveLength(3);
  });

  it('leaves out a field B does not have', () => {
    const { editorAuthor, ...noAuthor } = B_META;
    const c = JSON.parse(convertMidstFile(oldFile(noAuthor)));
    expect(c.meta).not.toHaveProperty('author');
  });

  it('a converted file keeps its meta through open and save', () => {
    const converted = convertMidstFile(oldFile(B_META));
    loadDataIntoWorkspace(
      '/x.midst',
      includeVersionInfo(converted),
      window,
      false
    );
    expect(saved().meta).toEqual(JSON.parse(converted).meta);
  });

  it('a save writes back unknown keys and out-of-range markers unchanged', () => {
    const meta = {
      fontSize: 12,
      draftMarkers: [{ index: 99, name: 'zq', defaultName: 'Draft 1' }],
      laterField: { x: 1 },
    };
    const file = JSON.stringify({ text: '<p>a</p>', history: [], meta });
    loadDataIntoWorkspace('/x.midst', includeVersionInfo(file), window, false);
    expect(saved().meta).toEqual(meta);
  });

  it("a poem without meta does not inherit the previous poem's", () => {
    loadDataIntoWorkspace(
      '/x.midst',
      includeVersionInfo(convertMidstFile(oldFile(B_META))),
      window,
      false
    );
    const plain = JSON.stringify({ text: '<p>a</p>', history: [] });
    loadDataIntoWorkspace('/y.midst', includeVersionInfo(plain), window, false);
    expect(saved()).not.toHaveProperty('meta');
  });
});
