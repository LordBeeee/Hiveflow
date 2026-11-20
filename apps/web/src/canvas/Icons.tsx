export type IconName =
  | 'library'
  | 'download'
  | 'home'
  | 'spaces'
  | 'grid'
  | 'design'
  | 'motion'
  | 'cube'
  | 'video'
  | 'audio'
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
  library: <path d="M3 4h4v16H3zM10 4h4v16h-4zM17 5l3-1 4 15-3 1-4-15Z" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  home: <path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9" />,
  spaces: (
    <>
      <rect x="3" y="13" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <path d="M7 13V8a2 2 0 0 1 2-2h5m3 4v6a2 2 0 0 1-2 2h-5" />
    </>
  ),
  grid: <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z" />,
  design: <path d="M4 3h16v18H4zM4 8h16M9 8v13m3-10 6 3-3 1-1 3-2-7Z" />,
  motion: <path d="M3 5h4l4 14 4-14h6M3 12h5m8 0h5M9 21h7" />,
  cube: <path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v9" />,
  video: (
    <>
      <rect x="3" y="5" width="13" height="14" rx="3" />
      <path d="m16 10 5-3v10l-5-3Z" />
    </>
  ),
  audio: (
    <>
      <path d="M4 9v6m4-10v14m4-16v18m4-15v12m4-9v6" />
    </>
  ),
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
