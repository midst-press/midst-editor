import { useCurrentEditor } from '@tiptap/react';
// Types only, erased from the build. toggleBold and toggleItalic are added to ChainedCommands by the bold and
// italic extensions' `declare module '@tiptap/core'`, which StarterKit's types load. The extensions themselves
// come in through vendor/midst-format, which this file does not import, so without this line a compile of this
// file alone (ts-jest on a cold cache) does not see them (#231).
import type {} from '@tiptap/starter-kit';
import FormatBoldIcon from '@mui/icons-material/FormatBoldOutlined';
import FormatItalicIcon from '@mui/icons-material/FormatItalicOutlined';
import TextIncreaseIcon from '@mui/icons-material/TextIncrease';
import TextDecreaseIcon from '@mui/icons-material/TextDecrease';

import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import { useEffect } from 'react';
import useFontSize from '../../fontSize/useFontSize';
import setEditorSizeClass from '../../fontSize/setEditorSizeClass';
import { i18n } from '../../../shared/i18n';

function MenuBar() {
  const { editor } = useCurrentEditor();

  // The `!editor` guard lives below, after every hook. tiptap's EditorProvider returns null until
  // the editor exists and MenuBar is its slotBefore, so in practice the guard never fires -- but
  // placing it above the hooks made the hook count conditional, which a tiptap change that renders
  // slotBefore eagerly would turn into a hard "Rendered more hooks than during the previous render".
  const fontSize = useFontSize();
  // The size class lives on the editor surface, which tiptap owns.
  useEffect(() => {
    if (editor) setEditorSizeClass(editor, fontSize.size);
  }, [editor, fontSize.size]);

  if (!editor) {
    return null;
  }

  return (
    <div className="TopButtons">
      <Tooltip
        title={i18n._('textSize.increase')}
        TransitionComponent={Zoom}
        enterDelay={500}
        arrow
      >
        <span>
          <button
            aria-label={i18n._('textSize.increase')}
            type="button"
            onClick={fontSize.increase}
            disabled={!fontSize.canIncrease}
            className="icon-button size-icon"
          >
            <TextIncreaseIcon fontSize="small" />
          </button>
        </span>
      </Tooltip>
      <Tooltip
        title={i18n._('textSize.decrease')}
        TransitionComponent={Zoom}
        enterDelay={500}
        arrow
      >
        <span>
          <button
            aria-label={i18n._('textSize.decrease')}
            type="button"
            disabled={!fontSize.canDecrease}
            className="icon-button size-icon"
            onClick={fontSize.decrease}
          >
            <TextDecreaseIcon fontSize="small" />
          </button>
        </span>
      </Tooltip>
      <Tooltip
        title={i18n._('format.bold')}
        TransitionComponent={Zoom}
        enterDelay={500}
        arrow
      >
        <button
          aria-label={i18n._('format.bold')}
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          className={
            editor.isActive('bold') ? 'is-active icon-button' : 'icon-button'
          }
        >
          <FormatBoldIcon fontSize="small" />
        </button>
      </Tooltip>
      <Tooltip
        title={i18n._('format.italic')}
        TransitionComponent={Zoom}
        enterDelay={500}
        arrow
      >
        <button
          aria-label={i18n._('format.italic')}
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          className={
            editor.isActive('italic') ? 'is-active icon-button' : 'icon-button'
          }
        >
          <FormatItalicIcon fontSize="small" />
        </button>
      </Tooltip>
    </div>
  );
}
export default MenuBar;
