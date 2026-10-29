import { MutableRefObject, useEffect, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { ChangeObj, reconstructHTML } from '@midst-press/midst-format/history';
import {
  scrollParent,
  targetScrollTop,
  glideTo,
  Glide,
  gliding,
} from '@midst-press/midst-format/follow';
import useAutoscroll from './useAutoscroll';

// The frame Replay shows, put into its editor, and the view following the writing to where it changed,
// when the poet has Follow on. `glideRef` holds the scroll under way, which playback also reads, so as not to
// move on while the view is still getting there.
export default function useFollowWriting(
  editor: Editor | null,
  poemHistory: ChangeObj[],
  step: number,
  glideRef: MutableRefObject<Glide | null>
) {
  const autoscroll = useAutoscroll();
  // Read by the follow effect without re-running it: turning the setting over changes no frame.
  // Kept current by an effect, not during render. Declared before the follow effect, so it runs first.
  const following = useRef(autoscroll.on);
  useEffect(() => {
    following.current = autoscroll.on;
  }, [autoscroll.on]);
  const toggle = () => {
    // Turned off mid-glide: stop where it is, so playback does not wait on a scroll the poet turned off.
    if (!autoscroll.toggle() && glideRef.current && gliding(glideRef.current)) {
      cancelAnimationFrame(glideRef.current.frame);
      // eslint-disable-next-line no-param-reassign -- the ref is the glide handle, shared with playback
      glideRef.current = null;
    }
  };

  useEffect(() => {
    if (!editor) return;
    const before = editor.state.doc;
    const newContent = reconstructHTML('', poemHistory, step);
    editor.commands.setContent(newContent, {
      emitUpdate: false,
      parseOptions: { preserveWhitespace: true },
    });
    // Follow the writing: see ./follow.ts for why this does not use the recorded pos.
    const after = editor.state.doc;
    const changed = after.content.findDiffStart(before.content);
    const scroller = scrollParent(editor.view.dom as HTMLElement);
    if (following.current && changed != null && scroller) {
      const at = Math.min(changed, after.content.size);
      const point = editor.view.coordsAtPos(at);
      const to = targetScrollTop(
        point,
        scroller.getBoundingClientRect(),
        scroller.scrollTop,
        scroller.scrollHeight
      );
      if (to != null)
        glideRef.current = glideTo(scroller, to, glideRef.current);
    }
  }, [step, poemHistory, editor, glideRef]);

  return { on: autoscroll.on, toggle };
}
