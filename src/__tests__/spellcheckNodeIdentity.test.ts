import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import poemExtensions from '@midst-press/midst-format/extensions';
import { redrawFromState } from '../renderer/spellcheck/checkWholePoem';
import SearchHighlight, {
  withHighlights,
} from '../renderer/search/searchHighlight';

// Chromium keeps a spelling mark on a DOM text node and adds marks only after an edit (issue #238). So any text node
// ProseMirror replaces loses its mark, and keeps it lost until something edits that paragraph again. These tests say
// which of a poet's actions replace the text node of a line they did not edit. Invented letters only.

let editor: Editor;

const textNode = (line: number): Node =>
  editor.view.dom.children[line].firstChild as Node;

const caretAt = (pos: number) =>
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos))
  );

beforeEach(() => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: [...poemExtensions, SearchHighlight],
    content: '<p>dlskfaj</p><p>sdfa</p><p>qzrv wplk</p>',
  });
});

afterEach(() => editor.destroy());

describe('which actions replace the text node of a line not edited', () => {
  it('Enter at the end of line 1 keeps line 2 and line 3 (her case 4)', () => {
    const [two, three] = [textNode(1), textNode(2)];
    caretAt(1 + 'dlskfaj'.length);
    editor.commands.splitBlock();
    expect(editor.view.dom.children[2].firstChild).toBe(two);
    expect(editor.view.dom.children[3].firstChild).toBe(three);
  });

  it('Enter in the middle of line 3 keeps lines 1 and 2', () => {
    const [one, two] = [textNode(0), textNode(1)];
    caretAt(editor.state.doc.content.size - 1 - ' wplk'.length);
    editor.commands.splitBlock();
    expect(textNode(0)).toBe(one);
    expect(textNode(1)).toBe(two);
  });

  it('typing on line 1 keeps lines 2 and 3', () => {
    const [two, three] = [textNode(1), textNode(2)];
    caretAt(1 + 'dlskfaj'.length);
    editor.commands.insertContent('x');
    expect(textNode(1)).toBe(two);
    expect(textNode(2)).toBe(three);
  });

  it('a Find highlight on line 3 keeps lines 1 and 2, and replaces line 3', () => {
    const [one, two, three] = [textNode(0), textNode(1), textNode(2)];
    const from = editor.state.doc.content.size - 1 - 'wplk'.length;
    editor.view.dispatch(
      withHighlights(editor.state.tr, {
        matches: [{ from, to: from + 4 }],
        current: 0,
      })
    );
    expect(textNode(0)).toBe(one);
    expect(textNode(1)).toBe(two);
    expect(textNode(2)).not.toBe(three);
  });

  it('redrawFromState replaces every line', () => {
    const before = [0, 1, 2].map(textNode);
    redrawFromState(editor.view);
    [0, 1, 2].forEach((line) => expect(textNode(line)).not.toBe(before[line]));
  });
});
