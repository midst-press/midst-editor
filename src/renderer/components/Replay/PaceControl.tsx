import { FocusEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { cssVar } from '../../cssVars';
import { PaceSetting } from './usePace';

// A pace button for the Timeline's control bar (GitHub #49, editor #427), after the website's speedometer
// (midst-web SpeedControl): the button opens a narrow slider above it, which shows its value as it moves.
// Escape, a click outside it, or the focus moving to something else closes it.
export default function PaceControl({
  setting,
  value,
  onChange,
  label,
  valueText,
  icon,
}: {
  setting: PaceSetting;
  value: number;
  onChange: (next: number) => void; // eslint-disable-line no-unused-vars
  label: string;
  valueText: string;
  icon: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  // On the button and the slider, not the wrapper. Only focus moving to something else closes it: after a
  // mouse click the Timeline blurs the clicked button with nowhere to go (useReplayKeys), and that must not
  // close the slider the same click opened (vivian-1a61bc9a, #437). A click outside closes it instead.
  const onBlur = (event: FocusEvent) => {
    const to = event.relatedTarget as Node | null;
    if (to && !control.current?.contains(to)) setOpen(false);
  };
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => {
      if (!control.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape closes an open slider wherever the focus is, and goes no further: after a mouse click the Timeline has
    // taken the focus off the button, and its own Escape would leave for Edit (e2e pace-controls, #437). Caught on
    // the way down, so it runs before the Timeline's listener.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    // Into the slider, so the arrow keys move it at once.
    slider.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return (
    <div className="pace-control" ref={control}>
      <button
        ref={button}
        type="button"
        className="control-bar-icon"
        aria-label={label}
        aria-expanded={open}
        style={{ color: cssVar('onControlBar') }}
        onClick={() => setOpen((current) => !current)}
        onBlur={onBlur}
      >
        {icon}
      </button>
      {open && (
        <div
          className="pace-popup"
          role="group"
          aria-label={label}
          style={{ backgroundColor: cssVar('controlBar') }}
        >
          <input
            ref={slider}
            type="range"
            className="pace-slider"
            aria-label={label}
            aria-valuetext={valueText}
            min={setting.min}
            max={setting.max}
            step={setting.step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            onBlur={onBlur}
          />
          <output
            className="pace-value"
            style={{ color: cssVar('onControlBar') }}
          >
            {valueText}
          </output>
        </div>
      )}
    </div>
  );
}

// The website's speedometer, drawn the same way (midst-web SpeedControl).
export function SpeedometerIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 19a10 10 0 1 1 18 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="m12 13 4-4M6 13H5m3-6L7 6m5-1V4m6 9h1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="13" r="2" fill="currentColor" />
    </svg>
  );
}
