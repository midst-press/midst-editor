import { CSSProperties, ReactNode, Ref } from 'react';
import Tooltip, { TooltipProps } from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import { UNAVAILABLE_STYLE } from '../DraftMarkers/useDraftMarkers';

// A Replay button that says why it cannot be used, when it cannot (#273, GitHub #66): in its tooltip,
// which needs the span because a disabled button gets no mouse events, and as its description, for a
// screen reader. When it can be used, the tooltip is its name.
/* eslint-disable react/require-default-props -- defaultProps on a function component is deprecated (React
   18.3 warns of it); an optional prop left out is undefined, which is what each of these means */
interface ReasonButtonProps {
  label: string;
  // Why it cannot be used now, or null when it can.
  reason: string | null;
  // The id of the hidden description, unique on the page.
  reasonId: string;
  onClick: () => void;
  className: string;
  style?: CSSProperties;
  spanClassName?: string;
  placement?: TooltipProps['placement'];
  classes?: TooltipProps['classes'];
  buttonRef?: Ref<HTMLButtonElement>;
  // Shown in the span after the button: what the button has just done, such as a refusal or an undo.
  after?: ReactNode;
  children: ReactNode;
}
/* eslint-enable react/require-default-props */

export default function ReasonButton({
  label,
  reason,
  reasonId,
  onClick,
  className,
  style,
  spanClassName,
  placement,
  classes,
  buttonRef,
  after,
  children,
}: ReasonButtonProps) {
  return (
    <Tooltip
      title={reason ?? label}
      TransitionComponent={Zoom}
      enterDelay={1000}
      arrow
      placement={placement}
      classes={classes}
    >
      <span className={spanClassName}>
        <button
          ref={buttonRef}
          aria-label={label}
          aria-describedby={reason ? reasonId : undefined}
          type="button"
          className={className}
          style={reason ? { ...style, ...UNAVAILABLE_STYLE } : style}
          onClick={onClick}
          disabled={reason !== null}
        >
          {children}
        </button>
        {reason && (
          <span id={reasonId} hidden>
            {reason}
          </span>
        )}
        {after}
      </span>
    </Tooltip>
  );
}
