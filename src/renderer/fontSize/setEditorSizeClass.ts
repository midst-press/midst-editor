import { Editor } from '@tiptap/core';

// Replaces the editor surface's size-N class, keeping its other classes.
export default function setEditorSizeClass(editor: Editor, size: number) {
  const attributes = (editor.options.editorProps.attributes ?? {}) as Record<
    string,
    string
  >;
  const classes = (attributes.class ?? '')
    .split(' ')
    .filter((name) => name !== '' && !name.startsWith('size-'));
  editor.setOptions({
    editorProps: {
      attributes: {
        ...attributes,
        class: [...classes, `size-${size}`].join(' '),
      },
    },
  });
}
