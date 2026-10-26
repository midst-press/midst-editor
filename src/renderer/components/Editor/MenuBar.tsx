import { useCurrentEditor, useEditorState } from '@tiptap/react';
// Types only, erased from the build. toggleBold, toggleItalic, toggleUnderline and toggleStrike are added to
// ChainedCommands by the mark extensions' `declare module '@tiptap/core'`, which StarterKit's types load. The extensions themselves
// come in through vendor/midst-format, which this file does not import, so without this line a compile of this
// file alone (ts-jest on a cold cache) does not see them (#231).
import type {} from '@tiptap/starter-kit';
import FormatBoldIcon from '@mui/icons-material/FormatBoldOutlined';
import FormatItalicIcon from '@mui/icons-material/FormatItalicOutlined';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlinedOutlined';
import StrikethroughIcon from '@mui/icons-material/StrikethroughSOutlined';
import type { ReactNode } from 'react';
import MoonOutlinedIcon from '@mui/icons-material/ModeNightOutlined';
import TextIncreaseIcon from '@mui/icons-material/TextIncrease';
import TextDecreaseIcon from '@mui/icons-material/TextDecrease';

import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import { useEffect, useId } from 'react';
import useFontSize from '../../fontSize/useFontSize';
import setEditorSizeClass from '../../fontSize/setEditorSizeClass';
import { i18n } from '../../../shared/i18n';
import { UNAVAILABLE_STYLE } from '../DraftMarkers/useDraftMarkers';

// One formatting button (#140): its tooltip says why it can't be used when it can't (#284, GitHub #66). tiptap says
// only that a mark cannot be applied here, not why, so each mark gives a general reason.
type MarkButtonProps = {
  label: string;
  unavailable: string | null;
  active: boolean;
  toggle: () => void;
  icon: ReactNode;
};
function MarkButton({
  label,
  unavailable,
  active,
  toggle,
  icon,
}: MarkButtonProps) {
  const reasonId = useId();
  return (
    <Tooltip
      title={unavailable ?? label}
      TransitionComponent={Zoom}
      enterDelay={500}
      arrow
    >
      <span>
        <button
          aria-label={label}
          aria-describedby={unavailable ? reasonId : undefined}
          type="button"
          onClick={toggle}
          disabled={unavailable !== null}
          className={active ? 'is-active icon-button' : 'icon-button'}
          style={unavailable ? UNAVAILABLE_STYLE : undefined}
        >
          {icon}
        </button>
        {unavailable && (
          <span id={reasonId} hidden>
            {unavailable}
          </span>
        )}
      </span>
    </Tooltip>
  );
}

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
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        canBold: e.can().chain().focus().toggleBold().run(),
        canItalic: e.can().chain().focus().toggleItalic().run(),
        canUnderline: e.can().chain().focus().toggleUnderline().run(),
        canStrike: e.can().chain().focus().toggleStrike().run(),
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
  // Why each size button cannot be used now, or null when it can (#284, GitHub #66).
  const largestReason = fontSize.canIncrease
    ? null
    : i18n._('textSize.largest');
  const smallestReason = fontSize.canDecrease
    ? null
    : i18n._('textSize.smallest');
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
      <MarkButton
        label={i18n._('format.bold')}
        unavailable={marks.canBold ? null : i18n._('format.bold.unavailable')}
        active={marks.bold}
        toggle={() => editor.chain().focus().toggleBold().run()}
        icon={<FormatBoldIcon fontSize="small" />}
      />
      <MarkButton
        label={i18n._('format.italic')}
        unavailable={
          marks.canItalic ? null : i18n._('format.italic.unavailable')
        }
        active={marks.italic}
        toggle={() => editor.chain().focus().toggleItalic().run()}
        icon={<FormatItalicIcon fontSize="small" />}
      />
      <MarkButton
        label={i18n._('format.underline')}
        unavailable={
          marks.canUnderline ? null : i18n._('format.underline.unavailable')
        }
        active={marks.underline}
        toggle={() => editor.chain().focus().toggleUnderline().run()}
        icon={<FormatUnderlinedIcon fontSize="small" />}
      />
      <MarkButton
        label={i18n._('format.strike')}
        unavailable={
          marks.canStrike ? null : i18n._('format.strike.unavailable')
        }
        active={marks.strike}
        toggle={() => editor.chain().focus().toggleStrike().run()}
        icon={<StrikethroughIcon fontSize="small" />}
      />
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
