import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

// Tab and Shift-Tab in the poem (Annelyse, GitHub #30; editor #431).
//
// - Tab with the cursor in a line, or with part of one line selected, puts a tab there, as it always has: a tab partway
//   through a line still works.
// - Tab with a selection reaching across lines puts a tab at the start of each of those lines, and keeps the selection.
// - Shift-Tab takes a tab away: the one just before the cursor if there is one, so it undoes the tab just typed even
//   partway through a line; otherwise one tab from the start of the line. With a selection, one tab from the start of
//   each selected line that begins with one. Backspace still deletes a tab as any character.
//
// A line is a paragraph, or the text after a line break inside one. A selection that ends at the very start of a line
// does not take that line in, as in other editors. Each key is one change, so one Undo puts it back.

const TAB = '\t';

/** Where the line holding `pos` starts: the start of its text block, or just after the last line break before it.
 *  Null when `pos` is between blocks (Select All starts there), which holds no line. */
function lineStartAt(doc: PMNode, pos: number): number | null {
  const $pos = doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  let start = $pos.start();
  $pos.parent.forEach((child, offset) => {
    const at = $pos.start() + offset;
    if (child.type.name === 'hardBreak' && at < pos)
      start = at + child.nodeSize;
  });
  return start;
}

/** The start of every line the selection touches, in document order. */
export function selectedLineStarts(state: EditorState): number[] {
  const { from, to, empty } = state.selection;
  const first = lineStartAt(state.doc, from);
  const starts = first === null ? [] : [first];
  state.doc.nodesBetween(from, to, (node, pos) => {
    let start: number | null = null;
    if (node.isTextblock) start = pos + 1;
    else if (node.type.name === 'hardBreak') start = pos + node.nodeSize;
    // A line counts only if the selection reaches into it: not one it ends exactly at the start of.
    if (
      start !== null &&
      start > from &&
      (start < to || (empty && start === to))
    )
      starts.push(start);
    return true;
  });
  return Array.from(new Set(starts)).sort((a, b) => a - b);
}

const HandleTab = Extension.create({
  name: 'handleTab',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { state, view } = this.editor;
        const starts = selectedLineStarts(state);
        if (state.selection.empty || starts.length < 2)
          return this.editor.commands.insertContent(TAB);
        const { tr } = state;
        // From the last line up, so each insert leaves the earlier positions where they were.
        [...starts].reverse().forEach((start) => tr.insertText(TAB, start));
        view.dispatch(tr);
        return true;
      },
      'Shift-Tab': () => {
        const { state, view } = this.editor;
        const { selection, doc } = state;
        let remove: number[];
        const before = selection.from - 1;
        if (
          selection.empty &&
          before >= 0 &&
          doc.textBetween(before, selection.from) === TAB
        )
          remove = [before];
        else
          remove = selectedLineStarts(state).filter(
            (start) =>
              start < doc.content.size &&
              doc.textBetween(start, start + 1) === TAB
          );
        // Handled either way, so Shift-Tab never takes the poet out of the poem.
        if (!remove.length) return true;
        const { tr } = state;
        [...remove].reverse().forEach((at) => tr.delete(at, at + 1));
        view.dispatch(tr);
        return true;
      },
    };
  },
});

// Named const plus a default export: the binding keeps the symbol greppable and visible in stack traces.
export default HandleTab;
