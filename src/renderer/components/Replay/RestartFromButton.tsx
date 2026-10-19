import { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import { getSchema } from '@tiptap/core';
import { DOMParser as ProseMirrorParser } from '@tiptap/pm/model';
import poemExtensions from '@midst-press/midst-format/extensions';
import { HistoryContext, TextContext } from 'renderer/context';
import { ChangeObj, reconstruct } from '@midst-press/midst-format/history';
import {
  RestartFromError,
  restartFrom,
  wouldChange,
} from 'renderer/tracking/restartFrom';
import { cssVar } from '../../cssVars';
import { UNAVAILABLE_STYLE } from '../DraftMarkers/useDraftMarkers';
import RestartIcon from './restartIcon';
import { i18n } from '../../../shared/i18n';

// Restart from an arbitrary point (GitHub #18). The poet picks a frame while replaying and presses this;
// one change is APPENDED to the history so the current text becomes that frame's text. See
// tracking/restartFrom.ts for the data layer.

// What the poet is told, read from the catalog when it is shown.
export const nothingToChange = () => i18n._('restart.nothingToChange');
export const noHistory = () => i18n._('restart.noHistory');
export const unreplayable = () => i18n._('restart.unreplayable');
export const failedMessage = () => i18n._('restart.failed');
// Fixed log messages, which never quote the poem.
export const MISMATCH_LOG = 'the history does not replay to the current text';
export const NO_DIFFERENCE_LOG =
  'the chosen frame and the current text have no difference';
export const FAILED_LOG = 'restart from here failed';

const schema = getSchema(poemExtensions);
// Parsed as the editor parses its content: by the browser's own DOM parser, whitespace preserved.
// (@tiptap/html's generateJSON is for a server; it needs a DOM library the renderer does not ship.)
const parser = ProseMirrorParser.fromSchema(schema);
const docOf = (html: string) =>
  parser.parse(new window.DOMParser().parseFromString(html, 'text/html').body, {
    preserveWhitespace: true,
  });

class RefusedRestart extends Error {}

type Availability = { reason: string | null; error: unknown };

function availability(history: ChangeObj[], step: number): Availability {
  if (history.length === 0) return { reason: noHistory(), error: null };
  try {
    return {
      reason: wouldChange(history, step) ? null : nothingToChange(),
      error: null,
    };
  } catch (error) {
    return { reason: unreplayable(), error };
  }
}

export default function RestartFromButton({
  step,
  pause,
}: {
  step: number;
  pause: () => void;
}) {
  const navigate = useNavigate();
  const { poemHistory, setPoemHistory } = useContext(HistoryContext);
  const { text: htmlString, setText: setHtmlString } = useContext(TextContext);
  const [failed, setFailed] = useState(false);

  const { reason, error } = useMemo(
    () => availability(poemHistory, step),
    [poemHistory, step]
  );
  // A frame that cannot be checked is an anomaly, unlike an empty history: log it, once per cause.
  useEffect(() => {
    if (error)
      window.electron.log.error(
        error instanceof RestartFromError ? error.message : FAILED_LOG,
        {
          step,
          frames: poemHistory.length,
          name: error instanceof Error ? error.name : typeof error,
        }
      );
  }, [error, step, poemHistory.length]);

  const restart = () => {
    pause();
    setFailed(false);
    const meta = { step, frames: poemHistory.length };
    try {
      const chosen = reconstruct('', poemHistory, step);
      const current = reconstruct('', poemHistory, poemHistory.length - 1);
      if (current !== htmlString) throw new RefusedRestart(MISMATCH_LOG);
      const pos = docOf(chosen).content.findDiffEnd(docOf(current).content)?.a;
      if (pos === undefined) throw new RefusedRestart(NO_DIFFERENCE_LOG);
      const next = restartFrom(poemHistory, step, pos, new Date());
      // The store is updated BEFORE navigating, and the live editor is never given setContent: its
      // onUpdate would append a second change.
      setPoemHistory(next);
      setHtmlString(chosen);
      window.electron.store.set('edited', JSON.stringify(true));
      navigate('/editor');
    } catch (e) {
      // Only our own errors have messages known not to quote the poem; any other is logged by name.
      const known =
        e instanceof RestartFromError || e instanceof RefusedRestart;
      window.electron.log.error(known ? e.message : FAILED_LOG, {
        ...meta,
        name: e instanceof Error ? e.name : typeof e,
      });
      setFailed(true);
    }
  };

  return (
    <>
      <Tooltip
        title={reason ?? i18n._('restart.button')}
        TransitionComponent={Zoom}
        enterDelay={1000}
        arrow
        placement="top-end"
        classes={{ arrow: 'custom-arrow', tooltip: 'custom' }}
      >
        <span>
          <button
            aria-label={i18n._('restart.button')}
            aria-describedby={reason ? 'replay-restart-reason' : undefined}
            type="button"
            className="control-bar-icon"
            style={{
              color: cssVar('onControlBar'),
              ...(reason ? UNAVAILABLE_STYLE : {}),
            }}
            disabled={reason !== null}
            onClick={restart}
          >
            <RestartIcon fontSize="small" />
          </button>
          {reason && (
            <span id="replay-restart-reason" hidden>
              {reason}
            </span>
          )}
        </span>
      </Tooltip>
      {failed && (
        <span role="alert" style={{ color: cssVar('errorLight') }}>
          {failedMessage()}
        </span>
      )}
    </>
  );
}
