import { useCurrentEditor, useEditorState } from '@tiptap/react';
// Types only, erased from the build. toggleBold and toggleItalic are added to ChainedCommands by the bold and
// italic extensions' `declare module '@tiptap/core'`, which StarterKit's types load. The extensions themselves
// come in through vendor/midst-format, which this file does not import, so without this line a compile of this
// file alone (ts-jest on a cold cache) does not see them (#231).
import type {} from '@tiptap/starter-kit';
import FormatBoldIcon from '@mui/icons-material/FormatBoldOutlined';
import FormatItalicIcon from '@mui/icons-material/FormatItalicOutlined';
import MoonOutlinedIcon from '@mui/icons-material/ModeNightOutlined';
import TextIncreaseIcon from '@mui/icons-material/TextIncrease';
import TextDecreaseIcon from '@mui/icons-material/TextDecrease';

import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import { useEffect } from 'react';
import useFontSize from '../../fontSize/useFontSize';
import setEditorSizeClass from '../../fontSize/setEditorSizeClass';
import { i18n } from '../../../shared/i18n';
import { UNAVAILABLE_STYLE } from '../DraftMarkers/useDraftMarkers';

interface MenuBarProps {
  // Focus Mode (GitHub #25): the poet's screen, with everything but the moon hidden.
  focused: boolean;
  onToggleFocus: () => void;
}

function MenuBar({ focused, onToggleFocus }: MenuBarProps) {
  const { editor } = useCurrentEditor();
  // TipTap 3 does not re-render a component on each transaction (TipTap 2 did), so the buttons subscribe to the
  // state they show: each mark's active state, and whether it can be applied here.
  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e && {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        canBold: e.can().chain().focus().toggleBold().run(),
        canItalic: e.can().chain().focus().toggleItalic().run(),
      },
  });

  // The `!editor` guard lives below, after every hook. tiptap's EditorProvider returns null until
  // the editor exists and MenuBar is its slotBefore, so in practice the guard never fires -- but
  // placing it above the hooks made the hook count conditional, which a tiptap change that renders
  // slotBefore eagerly would turn into a hard "Rendered more hooks than during the previous render".
  const fontSize = useFontSize();
  // The size class lives on the editor surface, which tiptap owns.
  useEffect(() => {
    if (editor) setEditorSizeClass(editor, fontSize.size);
  }, [editor, fontSize.size]);

  if (!editor || !marks) {
    return null;
  }
  // Why each button cannot be used now, or null when it can (#284, GitHub #66). tiptap says only that a mark cannot
  // be applied here, not why, so Bold and Italic give a general reason.
  const largestReason = fontSize.canIncrease
    ? null
    : i18n._('textSize.largest');
  const smallestReason = fontSize.canDecrease
    ? null
    : i18n._('textSize.smallest');
  const boldReason = marks.canBold ? null : i18n._('format.bold.unavailable');
  const italicReason = marks.canItalic
    ? null
    : i18n._('format.italic.unavailable');
  // The moon is the last control on the bar, and in focus mode the only one. The gap to its left
  // separates it slightly from the font options (Annelyse, GitHub #25). `aria-pressed` says which
  // mode the poet is in, in the same way the bold and italic buttons say which marks are on.
  const moon = (
    <Tooltip
      title={
        focused
          ? i18n._('focusMode.exit.tooltip')
          : i18n._('focusMode.enter.tooltip')
      }
      TransitionComponent={Zoom}
      enterDelay={500}
      arrow
    >
      <button
        aria-label={i18n._('focusMode.toggle')}
        aria-pressed={focused}
        type="button"
        onClick={onToggleFocus}
        className="icon-button focus-mode-icon"
      >
        <MoonOutlinedIcon fontSize="small" />
      </button>
    </Tooltip>
  );

  // The font options, wrapped so focus mode can return just the moon and leave these out (GitHub #25).
  const fontControls = (
    <>
      <Tooltip
        title={largestReason ?? i18n._('textSize.increase')}
        TransitionComponent={Zoom}
        enterDelay={500}
        arrow
      >
        <span>
          <button
            aria-label={i18n._('textSize.increase')}
            aria-describedby={
              largestReason ? 'editor-largest-reason' : undefined
            }
            type="button"
            onClick={fontSize.increase}
            disabled={largestReason !== null}
            className="icon-button size-icon"
            style={largestReason ? UNAVAILABLE_STYLE : undefined}
          >
            <TextIncreaseIcon fontSize="small" />
          </button>
          {largestReason && (
            <span id="editor-largest-reason" hidden>
              {largestReason}
            </span>
          )}
        </span>
      </Tooltip>
      <Tooltip
        title={smallestReason ?? i18n._('textSize.decrease')}
        TransitionComponent={Zoom}
        enterDelay={500}
        arrow
      >
        <span>
          <button
            aria-label={i18n._('textSize.decrease')}
            aria-describedby={
              smallestReason ? 'editor-smallest-reason' : undefined
            }
            type="button"
            onClick={fontSize.decrease}
            disabled={smallestReason !== null}
            className="icon-button size-icon"
            style={smallestReason ? UNAVAILABLE_STYLE : undefined}
          >
            <TextDecreaseIcon fontSize="small" />
          </button>
          {smallestReason && (
            <span id="editor-smallest-reason" hidden>
              {smallestReason}
            </span>
          )}
        </span>
      </Tooltip>
      <Tooltip
        title={boldReason ?? i18n._('format.bold')}
        TransitionComponent={Zoom}
        enterDelay={500}
        arrow
      >
        <span>
          <button
            aria-label={i18n._('format.bold')}
            aria-describedby={boldReason ? 'editor-bold-reason' : undefined}
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            disabled={boldReason !== null}
            className={marks.bold ? 'is-active icon-button' : 'icon-button'}
            style={boldReason ? UNAVAILABLE_STYLE : undefined}
          >
            <FormatBoldIcon fontSize="small" />
          </button>
          {boldReason && (
            <span id="editor-bold-reason" hidden>
              {boldReason}
            </span>
          )}
        </span>
      </Tooltip>
      <Tooltip
        title={italicReason ?? i18n._('format.italic')}
        TransitionComponent={Zoom}
        enterDelay={500}
        arrow
      >
        <span>
          <button
            aria-label={i18n._('format.italic')}
            aria-describedby={italicReason ? 'editor-italic-reason' : undefined}
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            disabled={italicReason !== null}
            className={marks.italic ? 'is-active icon-button' : 'icon-button'}
            style={italicReason ? UNAVAILABLE_STYLE : undefined}
          >
            <FormatItalicIcon fontSize="small" />
          </button>
          {italicReason && (
            <span id="editor-italic-reason" hidden>
              {italicReason}
            </span>
          )}
        </span>
      </Tooltip>
    </>
  );

  return (
    <div className="TopButtons">
      {focused ? (
        moon
      ) : (
        <>
          {fontControls}
          <span className="focus-mode-gap" aria-hidden="true" />
          {moon}
        </>
      )}
    </div>
  );
}
export default MenuBar;
