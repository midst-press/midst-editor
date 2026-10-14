import { useCurrentEditor } from '@tiptap/react';
import FormatBoldIcon from '@mui/icons-material/FormatBoldOutlined';
import FormatItalicIcon from '@mui/icons-material/FormatItalicOutlined';
import TextIncreaseIcon from '@mui/icons-material/TextIncrease';
import TextDecreaseIcon from '@mui/icons-material/TextDecrease';

import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import { useEffect } from 'react';
import useFontSize from '../../fontSize/useFontSize';
import setEditorSizeClass from '../../fontSize/setEditorSizeClass';

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
        title="Increase text size"
        TransitionComponent={Zoom}
        enterDelay={500}
        arrow
      >
        <span>
          <button
            aria-label="Increase text size"
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
        title="Decrease text size"
        TransitionComponent={Zoom}
        enterDelay={500}
        arrow
      >
        <span>
          <button
            aria-label="Decrease text size"
            type="button"
            disabled={!fontSize.canDecrease}
            className="icon-button size-icon"
            onClick={fontSize.decrease}
          >
            <TextDecreaseIcon fontSize="small" />
          </button>
        </span>
      </Tooltip>
      <Tooltip title="Bold" TransitionComponent={Zoom} enterDelay={500} arrow>
        <button
          aria-label="Bold"
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
      <Tooltip title="Italic" TransitionComponent={Zoom} enterDelay={500} arrow>
        <button
          aria-label="Italic"
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
