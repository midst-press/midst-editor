import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Match } from './findInText';

// Shows the find bar's matches in the poem: every match lightly, the current one strongly.
//
// The matches are set by a transaction carrying only metadata, so the text never changes and the
// editor records no change in the poem's history. When the poet types while matches are shown, the
// highlights move with the text; the find bar then searches again and replaces them.

export interface Highlights {
  matches: Match[];
  current: number;
}

export const searchHighlightKey = new PluginKey<DecorationSet>(
  'searchHighlight'
);

export const MATCH_CLASS = 'search-match';
export const CURRENT_CLASS = 'search-match-current';

const decorate = (tr: Transaction, { matches, current }: Highlights) =>
  DecorationSet.create(
    tr.doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class:
          index === current ? `${MATCH_CLASS} ${CURRENT_CLASS}` : MATCH_CLASS,
      })
    )
  );

// Attach to a transaction to show these matches; an empty list clears them.
export const withHighlights = (tr: Transaction, highlights: Highlights) =>
  tr.setMeta(searchHighlightKey, highlights);

const SearchHighlight = Extension.create({
  name: 'searchHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: searchHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const highlights = tr.getMeta(searchHighlightKey) as
              | Highlights
              | undefined;
            if (highlights) return decorate(tr, highlights);
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => searchHighlightKey.getState(state),
        },
      }),
    ];
  },
});

export default SearchHighlight;
