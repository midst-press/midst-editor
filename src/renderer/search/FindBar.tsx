import CloseIcon from '@mui/icons-material/Close';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { Editor as EditorType } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import findInText, { Match } from './findInText';
import { withHighlights } from './searchHighlight';
import './FindBar.css';
import { i18n } from '../../shared/i18n';

// The find bar (GitHub #27): Edit > Find opens it, it searches the poem as it stands now, and it
// selects each match in the poem in turn. Earlier frames are not searched.

export const FIND_BAR_CLASS = 'find-bar';
// What the poet is told, read from the catalog when it is shown.
export const noMatches = () => i18n._('find.noMatches');
export const typeFirst = () => i18n._('find.typeFirst');
export const notReady = () => i18n._('find.notReady');
export const searchFailed = () => i18n._('find.failed');
// A problem is kept as which one it is and put into words when shown, so it follows View > Language.
type Problem = 'not-ready' | 'search-failed';
const PROBLEM_WORDS: Record<Problem, () => string> = {
  'not-ready': notReady,
  'search-failed': searchFailed,
};
// Logged when a search throws. Fixed, so the log never holds the poet's words.
export const SEARCH_FAILED_LOG = 'search in the poem failed';
export const CLEAR_FAILED_LOG = 'clearing the search marks failed';

interface Found {
  matches: Match[];
  current: number;
}
const NOTHING: Found = { matches: [], current: -1 };

export default function FindBar({ editor }: { editor: EditorType | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found>(NOTHING);
  const [problem, setProblem] = useState<Problem | null>(null);
  // Counts the times Edit > Find was chosen, so choosing it again with the bar open refocuses it.
  const [asked, setAsked] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Highlight the matches and, when `select`, select the current one: one transaction that changes
  // no text, so the editor records nothing in the poem's history.
  const show = useCallback(
    (next: Found, select = true) => {
      if (!editor || editor.isDestroyed) return;
      let tr = withHighlights(editor.state.tr, next);
      const match = next.matches[next.current];
      if (select && match)
        tr = tr
          .setSelection(TextSelection.create(tr.doc, match.from, match.to))
          .scrollIntoView();
      editor.view.dispatch(tr);
    },
    [editor]
  );

  // Search again. After the poet edits with the bar open, `keep` is the match to stay on, and the
  // selection is left alone: moving it would put their next keystroke over a match.
  const search = useCallback(
    (text: string, keep = 0, select = true) => {
      if (!editor) {
        setFound(NOTHING);
        setProblem(text ? 'not-ready' : null);
        return;
      }
      try {
        const matches = findInText(editor.state.doc, text);
        const current = matches.length
          ? Math.min(Math.max(keep, 0), matches.length - 1)
          : -1;
        const next = { matches, current };
        show(next, select);
        setFound(next);
        setProblem(null);
      } catch (error) {
        window.electron.log.error(SEARCH_FAILED_LOG, {
          error: error instanceof Error ? error.name : typeof error,
        });
        // Clear the last search's marks, so the poem does not show matches the bar says it lacks. The
        // editor may be what failed, so this can fail too: logged, never thrown out of the handler.
        try {
          show(NOTHING, false);
        } catch (clearError) {
          window.electron.log.error(CLEAR_FAILED_LOG, {
            error:
              clearError instanceof Error ? clearError.name : typeof clearError,
          });
        }
        setFound(NOTHING);
        setProblem('search-failed');
      }
    },
    [editor, show]
  );

  useEffect(
    () =>
      window.electron.ipcRenderer.on('find-in-poem', () => {
        setOpen(true);
        setAsked((n) => n + 1);
      }),
    []
  );

  // Once the bar has rendered: focus the field, with a query already typed selected, to type over it.
  useEffect(() => {
    if (!asked) return;
    input.current?.focus();
    input.current?.select();
  }, [asked]);

  // The poet may edit the poem with the bar open: the matches follow the text.
  useEffect(() => {
    if (!open || !editor || !query) return undefined;
    const again = () => search(query, found.current, false);
    editor.on('update', again);
    return () => {
      editor.off('update', again);
    };
  }, [open, editor, query, found, search]);

  const step = (by: number) => {
    const total = found.matches.length;
    if (!total) return;
    const next = { ...found, current: (found.current + by + total) % total };
    show(next);
    setFound(next);
  };

  const close = () => {
    // Back to the poem with the cursor just after the last match: the poet keeps their place, and their
    // next keystroke does not replace the match (a replacement would be recorded in the timelapse).
    const match = found.matches[found.current];
    if (editor && !editor.isDestroyed) {
      let tr = withHighlights(editor.state.tr, NOTHING);
      if (match) tr = tr.setSelection(TextSelection.create(tr.doc, match.to));
      editor.view.dispatch(tr);
    }
    setOpen(false);
    setProblem(null);
    editor?.commands.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  if (!open) return null;

  const total = found.matches.length;
  // When the search could not run, the alert says why; "No matches" would be untrue.
  let status = '';
  if (problem) status = '';
  else if (query && total === 0) status = noMatches();
  else if (total)
    status = i18n._('find.position', { current: found.current + 1, total });

  // Why the arrows are unavailable: nothing typed yet, or the status ("No matches").
  const describedBy = query ? 'find-bar-status' : 'find-bar-reason';

  return (
    <div className={FIND_BAR_CLASS} role="search">
      <input
        ref={input}
        type="text"
        aria-label={i18n._('find.field')}
        placeholder={i18n._('find.field')}
        value={query}
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value);
          search(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      <span id="find-bar-status" className="find-bar-status" role="status">
        {status}
      </span>
      {!query && (
        <span id="find-bar-reason" hidden>
          {typeFirst()}
        </span>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={i18n._('find.previous')}
        aria-describedby={describedBy}
        disabled={total === 0}
        onClick={() => step(-1)}
      >
        <KeyboardArrowUpIcon fontSize="small" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={i18n._('find.next')}
        aria-describedby={describedBy}
        disabled={total === 0}
        onClick={() => step(1)}
      >
        <KeyboardArrowDownIcon fontSize="small" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={i18n._('find.close')}
        onClick={close}
      >
        <CloseIcon fontSize="small" />
      </button>
      {problem && (
        <span className="find-bar-problem" role="alert">
          {PROBLEM_WORDS[problem]()}
        </span>
      )}
    </div>
  );
}
