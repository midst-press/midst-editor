// The flag of the United States, beside English only (Stuart, 20 Oct, editor #265): a cue that helps someone find
// the language control. A language is not a country, so no other language has a flag, and the language's own name
// is always shown beside it and is the accessible name; the flag is decorative.
const STRIPES = Array.from({ length: 13 }, (_, i) => i);

export default function UsFlag() {
  return (
    <svg
      className="language-flag"
      viewBox="0 0 19 10"
      width="19"
      height="10"
      aria-hidden="true"
      focusable="false"
    >
      {STRIPES.map((i) => (
        <rect
          key={i}
          x="0"
          y={(i * 10) / 13}
          width="19"
          height={10 / 13}
          fill={i % 2 === 0 ? '#B22234' : '#FFFFFF'}
        />
      ))}
      <rect x="0" y="0" width="7.6" height={(7 * 10) / 13} fill="#3C3B6E" />
    </svg>
  );
}
