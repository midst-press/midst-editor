import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { gliding, Glide } from './follow';

// One frame of the history every FRAME_MS while playing, held while a glide is under way.
const FRAME_MS = 60;
// Play from the last frame starts again from the first; the slider needs this long to move back.
const REWIND_MS = 250;

// Which frame of the history the replay shows, and playing through it. Both timers, the frame
// interval and the wait before playing from the start, are held here and cleared by pause, by
// reaching the last frame and by unmounting. The wait was once left running, so a pause or leaving
// the screen during it still started playback (#110).
export default function usePlayback(
  maxStep: number,
  glide: MutableRefObject<Glide | null>
) {
  const [step, setStep] = useState(maxStep);
  const [playing, setPlaying] = useState(false);
  const interval = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined
  );
  const rewind = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  const advance = () => {
    interval.current = setInterval(() => {
      // Never past the last frame: a step beyond it is no frame at all, and a draft cannot be
      // marked there, so the last frame was unmarkable once playback had ended.
      setStep((val) =>
        gliding(glide.current) ? val : Math.min(val + 1, maxStep)
      );
    }, FRAME_MS);
  };

  const play = () => {
    clearTimers();
    setPlaying(true);
    if (step >= maxStep) {
      setStep(0);
      rewind.current = setTimeout(() => {
        rewind.current = undefined;
        advance();
      }, REWIND_MS);
    } else {
      advance();
    }
  };

  useEffect(() => {
    if (step >= maxStep) pause();
  }, [step, maxStep, pause]);

  // The handles are refs, read when the cleanup runs.
  useEffect(() => clearTimers, []);

  return { step, setStep, playing, play, pause };
}
