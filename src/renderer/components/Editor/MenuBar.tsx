import { useCurrentEditor } from '@tiptap/react';
import FormatBoldIcon from '@mui/icons-material/FormatBoldOutlined';
import FormatItalicIcon from '@mui/icons-material/FormatItalicOutlined';
import TextIncreaseIcon from '@mui/icons-material/TextIncrease';
import TextDecreaseIcon from '@mui/icons-material/TextDecrease';

import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import { useState, useEffect } from 'react';

const MenuBar = () => {
  const { editor } = useCurrentEditor();

  if (!editor) {
    return null;
  }

  const restoreSizeClassSetting = window.electron.store.get('font-size')
    ? Number(window.electron.store.get('font-size'))
    : 2;
  const [sizeClass, setSizeClass] = useState<number>(
    [0, 1, 2, 3, 4].includes(restoreSizeClassSetting)
      ? restoreSizeClassSetting
      : 2
  );

  const decreaseSize = () => {
    if (sizeClass <= 0) {
      return;
    }
    window.electron.store.set('font-size', String(sizeClass - 1));

    // @ts-ignore
    const existingClasses = editor.options.editorProps.attributes?.class;
    const existingClassesList = existingClasses.split(' ');
    const newClasses = existingClassesList.filter(
      (item: string) => !item.includes('size')
    );
    newClasses.push(`size-${sizeClass - 1}`);
    editor.setOptions({
      editorProps: {
        // @ts-ignore
        attributes: {
          ...editor.options.editorProps.attributes,
          class: newClasses.join(' '),
        },
      },
    });

    setSizeClass(sizeClass - 1);
  };
  const increaseSize = () => {
    if (sizeClass >= 4) {
      return;
    }

    window.electron.store.set('font-size', String(sizeClass + 1));
    // @ts-ignore
    const existingClasses = editor.options.editorProps.attributes?.class;
    const existingClassesList = existingClasses.split(' ');

    const newClasses = existingClassesList.filter(
      (item: string) => !item.includes('size')
    );
    newClasses.push(`size-${sizeClass + 1}`);
    editor.setOptions({
      editorProps: {
        // @ts-ignore
        attributes: {
          ...editor.options.editorProps.attributes,
          class: newClasses.join(' '),
        },
      },
    });
    setSizeClass(sizeClass + 1);
  };
  useEffect(() => {
    const removeSetFontSize = window.electron.ipcRenderer.on(
      'set-font-size',
      (newSize) => {
        setSizeClass(Number(newSize));
        // @ts-ignore
        const existingClasses = editor.options.editorProps.attributes?.class;
        const existingClassesList = existingClasses.split(' ');
        const newClasses = existingClassesList.filter(
          (item: string) => !item.includes('size')
        );
        newClasses.push(`size-${newSize}`);
        editor.setOptions({
          editorProps: {
            // @ts-ignore
            attributes: {
              ...editor.options.editorProps.attributes,
              class: newClasses.join(' '),
            },
          },
        });
      }
    );
    return () => {
      removeSetFontSize();
    };
  }, []);

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
            onClick={increaseSize}
            disabled={sizeClass >= 4}
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
            disabled={sizeClass <= 0}
            className="icon-button size-icon"
            onClick={decreaseSize}
          >
            <TextDecreaseIcon fontSize="small" />
          </button>
        </span>
      </Tooltip>
      <Tooltip title="Bold" TransitionComponent={Zoom} enterDelay={500} arrow>
        <button
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
};
export default MenuBar;
