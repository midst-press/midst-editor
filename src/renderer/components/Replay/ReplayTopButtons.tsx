import { FontIncreaseIcon, FontDecreaseIcon } from '../../icons/AnnelyseIcons';

import { i18n } from '../../../shared/i18n';
import ReasonButton from './ReasonButton';

interface ReplayTopButtonsProps {
  fontSize: {
    canIncrease: boolean;
    canDecrease: boolean;
    increase: () => void;
    decrease: () => void;
  };
}

// Above the poem in Replay: the text size.
export default function ReplayTopButtons({ fontSize }: ReplayTopButtonsProps) {
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
        <FontIncreaseIcon fontSize="small" />
      </ReasonButton>
      <ReasonButton
        label={i18n._('textSize.decrease')}
        reason={fontSize.canDecrease ? null : i18n._('textSize.smallest')}
        reasonId="replay-smallest-reason"
        onClick={fontSize.decrease}
        className="icon-button size-icon"
      >
        <FontDecreaseIcon fontSize="small" />
      </ReasonButton>
    </div>
  );
}
