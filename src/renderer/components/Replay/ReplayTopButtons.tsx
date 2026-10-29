import Tooltip from '@mui/material/Tooltip';
import Zoom from '@mui/material/Zoom';
import TextIncreaseIcon from '@mui/icons-material/TextIncrease';
import TextDecreaseIcon from '@mui/icons-material/TextDecrease';
import VerticalAlignCenterIcon from '@mui/icons-material/VerticalAlignCenter';
import { i18n } from '../../../shared/i18n';
import ReasonButton from './ReasonButton';

interface ReplayTopButtonsProps {
  fontSize: {
    canIncrease: boolean;
    canDecrease: boolean;
    increase: () => void;
    decrease: () => void;
  };
  following: boolean;
  toggleFollowing: () => void;
}

// Above the poem in Replay: the text size, and whether the view follows the writing.
export default function ReplayTopButtons({
  fontSize,
  following,
  toggleFollowing,
}: ReplayTopButtonsProps) {
  return (
    <div className="TopButtons">
      {/* At the largest or smallest size the button says so (#273, GitHub #66), as the play button does. */}
      <ReasonButton
        label={i18n._('textSize.increase')}
        reason={fontSize.canIncrease ? null : i18n._('textSize.largest')}
        reasonId="replay-largest-reason"
        onClick={fontSize.increase}
        className="icon-button size-icon"
      >
        <TextIncreaseIcon fontSize="small" />
      </ReasonButton>
      <ReasonButton
        label={i18n._('textSize.decrease')}
        reason={fontSize.canDecrease ? null : i18n._('textSize.smallest')}
        reasonId="replay-smallest-reason"
        onClick={fontSize.decrease}
        className="icon-button size-icon"
      >
        <TextDecreaseIcon fontSize="small" />
      </ReasonButton>
      <Tooltip
        title={
          following ? i18n._('replay.follow.on') : i18n._('replay.follow.off')
        }
        TransitionComponent={Zoom}
        enterDelay={1000}
        arrow
      >
        <button
          aria-label={i18n._('replay.follow')}
          aria-pressed={following}
          type="button"
          className="icon-button size-icon"
          style={following ? undefined : { opacity: 0.5 }}
          onClick={toggleFollowing}
        >
          <VerticalAlignCenterIcon fontSize="small" />
        </button>
      </Tooltip>
    </div>
  );
}
