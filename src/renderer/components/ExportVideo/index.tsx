import './ExportVideo.css';
import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import poemExtensions from '@midst-press/midst-format/extensions';
import { ChangeObj, reconstructHTML } from '@midst-press/midst-format/history';
import { targetScrollTop } from '@midst-press/midst-format/follow';
import {
  BufferTarget,
  Mp4OutputFormat,
  Output,
  VideoSample,
  VideoSampleSource,
} from 'mediabunny';
import { FPS, SCROLL_SPEED, paceFromStore } from '../Replay/usePace';
import { FRAME_US, VIDEO_FPS, frameCount, glideStep, stepAt } from './timeline';

// File > Export as Video, proof of concept (#506). A hidden window shows this page; main asks for frame n, this
// page draws it, main captures the window and hands the pixels back here to be encoded, because WebCodecs exists
// only in a page. Nothing here writes the store or the poem: the history arrives by message and stays in memory.

interface Job {
  history: ChangeObj[];
  title: string;
  lastWritten: string;
  frameMs: number; // the poet's pace: one step of the history every frameMs
  peak: number; // the poet's scroll speed, viewports per second
  frames: number;
}

const twoFrames = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

export default function ExportVideo() {
  const [job, setJob] = useState<Job | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const target = useRef<number | null>(null);
  const shown = useRef(-1);
  const output = useRef<{ out: Output; source: VideoSampleSource } | null>(
    null
  );
  const editor = useEditor({
    extensions: poemExtensions,
    content: '',
    editable: false,
    parseOptions: { preserveWhitespace: true },
  });

  useEffect(() => {
    const ipc = window.electron.ipcRenderer;
    const fail = (e: unknown) => ipc.sendMessage('export-failed', [String(e)]);
    const removeLoad = ipc.on('export-load', (history, title) => {
      const maxStep = Math.max(history.length - 1, 0);
      const frameMs =
        1000 / paceFromStore(FPS, window.electron.store.get(FPS.key));
      const peak = paceFromStore(
        SCROLL_SPEED,
        window.electron.store.get(SCROLL_SPEED.key)
      );
      const last = history[maxStep]?.t;
      setJob({
        history,
        title,
        // Spelled out: 07/11/2026 reads as two different days in two countries.
        lastWritten: last
          ? // eslint-disable-next-line lingui/no-unlocalized-strings -- an Intl option, not text
            new Date(last).toLocaleDateString(undefined, { dateStyle: 'long' })
          : '',
        frameMs,
        peak,
        frames: frameCount(maxStep, frameMs),
      });
    });
    ipc.sendMessage('export-ready', []);
    return () => {
      removeLoad();
      // An unmount mid-export says so, rather than leaving main waiting. Not shown to anyone: main logs it.
      // eslint-disable-next-line lingui/no-unlocalized-strings
      if (output.current) fail('export page closed before the end');
    };
  }, []);

  useEffect(() => {
    if (!job || !editor) return undefined;
    const ipc = window.electron.ipcRenderer;
    const maxStep = Math.max(job.history.length - 1, 0);
    const fail = (e: unknown) => ipc.sendMessage('export-failed', [String(e)]);

    const removeFrame = ipc.on('export-frame', async (n) => {
      try {
        const step = stepAt(n, job.frameMs, maxStep);
        const el = scroller.current;
        if (step !== shown.current) {
          const before = editor.state.doc;
          editor.commands.setContent(reconstructHTML('', job.history, step), {
            emitUpdate: false,
            parseOptions: { preserveWhitespace: true },
          });
          shown.current = step;
          // Follow the writing, as Replay does with Follow on (useFollowWriting), on the video's clock.
          const after = editor.state.doc;
          const changed = after.content.findDiffStart(before.content);
          if (el && changed != null) {
            const point = editor.view.coordsAtPos(
              Math.min(changed, after.content.size)
            );
            const to = targetScrollTop(
              point,
              el.getBoundingClientRect(),
              el.scrollTop,
              el.scrollHeight
            );
            if (to != null) target.current = to;
          }
        }
        if (el && target.current != null) {
          el.scrollTop = glideStep(
            el.scrollTop,
            target.current,
            el.clientHeight,
            job.peak
          );
          if (el.scrollTop === target.current) target.current = null;
        }
        await twoFrames();
        ipc.sendMessage('export-frame-ready', [n]);
      } catch (e) {
        fail(e);
      }
    });

    const removeEncode = ipc.on(
      'export-encode',
      async (n, pixels, width, height) => {
        try {
          if (!output.current) {
            const out = new Output({
              format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
              target: new BufferTarget(),
            });
            // no-preference: prefer-hardware has no encoder on a machine without one (#506, Linux runner).
            const source = new VideoSampleSource({
              codec: 'avc',
              bitrate: 6_000_000,
              hardwareAcceleration: 'no-preference',
            });
            out.addVideoTrack(source, { frameRate: VIDEO_FPS });
            await out.start();
            output.current = { out, source };
          }
          const frame = new VideoFrame(pixels, {
            format: 'BGRA',
            codedWidth: width,
            codedHeight: height,
            timestamp: Math.round(n * FRAME_US),
            duration: Math.round(FRAME_US),
          });
          const sample = new VideoSample(frame);
          await output.current.source.add(sample);
          sample.close();
          frame.close();
          ipc.sendMessage('export-encoded', [n]);
        } catch (e) {
          fail(e);
        }
      }
    );

    const removeFinish = ipc.on('export-finish', async () => {
      try {
        const o = output.current;
        if (!o) throw new Error('no frames were encoded');
        await o.out.finalize();
        output.current = null;
        const { buffer } = o.out.target as BufferTarget;
        if (!buffer) throw new Error('the muxer produced no file');
        ipc.sendMessage('export-done', [new Uint8Array(buffer)]);
      } catch (e) {
        fail(e);
      }
    });

    ipc.sendMessage('export-loaded', [job.frames]);
    return () => {
      removeFrame();
      removeEncode();
      removeFinish();
    };
  }, [job, editor]);

  return (
    <div className="ExportVideo">
      <header className="ExportVideoHeader">
        <h1>{job?.title}</h1>
        <p>{job?.lastWritten}</p>
      </header>
      <div className="ExportVideoPoem" ref={scroller}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
