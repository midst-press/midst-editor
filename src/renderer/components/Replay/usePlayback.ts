import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { gliding, Glide } from '@midst-press/midst-format/follow';

// One frame of the history every FRAME_MS while playing, held while a glide is under way. The frame-rate
// slider (GitHub #49, editor #427) sets another pace; this is the one it starts at.
export const FRAME_MS = 60;
// Play from the last frame starts again from the first; the slider needs this long to move back.
const REWIND_MS = 250;

// Which frame of the history the replay shows, and playing through it. Both timers, the frame
// interval and the wait before playing from the start, are held here and cleared by pause, by
// reaching the last frame and by unmounting. The wait was once left running, so a pause or leaving
// the screen during it still started playback (#110).
export default function usePlayback(
  maxStep: number,
  glide: MutableRefObject<Glide | null>,
  frameMs: number = FRAME_MS
) {
  const [step, setStepState] = useState(maxStep);
  // The step as last set, for the interval and play to read without a state updater.
  const current = useRef(maxStep);
  const [playing, setPlaying] = useState(false);
  // The last frame, for the timers and setStep to read as it is now: the history can change while the
  // replay is open (#356).
  const last = useRef(maxStep);
  const interval = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined
  );
  const rewind = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The pace as last set, for advance to read; a change while playing takes effect below.
  const pace = useRef(frameMs);

  const clearTimers = () => {
    clearTimeout(rewind.current);
    rewind.current = undefined;
    clearInterval(interval.current);
    interval.current = undefined;
  };

  const pause = useCallback(() => {
    clearTimers();
    setPlaying(false);
  }, []);

  // Every change of step comes here, from playing, the slider or the drafts list, and reaching the last
  // frame stops playback. This is where that stop happens, not an effect watching the step (GitHub #44).
  const setStep = useCallback(
    (next: number) => {
      current.current = next;
      setStepState(next);
      if (next >= last.current) pause();
    },
    [pause]
  );

  // When the history changes, a playhead that was at the end follows it to the new end, and one that was
  // earlier stays where it is, unless the end is now before it (Cora, review of the #356 design).
  useEffect(() => {
    const before = last.current;
    last.current = maxStep;
    if (maxStep === before) return;
    if (current.current === before || current.current > maxStep)
      setStep(maxStep);
  }, [maxStep, setStep]);

  const advance = () => {
    interval.current = setInterval(() => {
      // Never past the last frame: a step beyond it is no frame at all, and a draft cannot be
      // marked there, so the last frame was unmarkable once playback had ended.
      if (!gliding(glide.current))
        setStep(Math.min(current.current + 1, last.current));
    }, pace.current);
  };

  const play = () => {
    // One frame has nothing to play through. Starting would never stop: the step is already the
    // last, so nothing changes for the stop at the end to see (review of #118).
    if (last.current <= 0) return;
    clearTimers();
    setPlaying(true);
    if (current.current >= last.current) {
      setStep(0);
      rewind.current = setTimeout(() => {
        rewind.current = undefined;
        advance();
      }, REWIND_MS);
    } else {
      advance();
    }
  };

  // A new pace while playing restarts the frame interval at it, from the frame shown.
  useEffect(() => {
    pace.current = frameMs;
    if (interval.current === undefined) return;
    clearInterval(interval.current);
    advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- advance reads only refs
  }, [frameMs]);

  // The handles are refs, read when the cleanup runs.
  useEffect(() => clearTimers, []);

  return { step, setStep, playing, play, pause };
}
