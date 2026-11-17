export type IconName =
  | 'plus'
  | 'cursor'
  | 'hand'
  | 'undo'
  | 'redo'
  | 'text'
  | 'image'
  | 'sparkles'
  | 'play'
  | 'trash'
  | 'minus'
  | 'fit'
  | 'chevron'
  | 'close'
  | 'search';
const paths: Record<IconName, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  cursor: <path d="m5 3 14 10-7 1-3 7-4-18Z" />,
  hand: (
    <>
      <path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v9c0 4-3 7-7 7h-1c-2 0-4-1-5-3l-4-6a2 2 0 0 1 3-2l2 2Z" />
    </>
  ),
  undo: (
    <path
      d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12"
      transform="translate(0 -2)"
    />
  ),
  redo: (
    <path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12" transform="translate(0 -2)" />
  ),
  text: (
    <>
      <path d="M4 5h16M12 5v15M8 20h8M4 5v3m16-3v3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 17 6-6 4 4 3-3 5 5" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="M20 2v4m-2-2h4" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8V4Z" />,
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    </>
  ),
  fit: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
