export type IconName =
  | "album"
  | "back"
  | "close"
  | "ethernet"
  | "folder"
  | "home"
  | "library"
  | "menu"
  | "next"
  | "nowPlaying"
  | "pause"
  | "play"
  | "plus"
  | "previous"
  | "queue"
  | "repeat"
  | "shuffle"
  | "settings"
  | "sources"
  | "usb"
  | "volume"
  | "volumeMuted"
  | "wifi";

const paths: Record<IconName, string> = {
  album:
    '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 15 3-3 5 5"/><circle cx="15.5" cy="8.5" r="1.5"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  ethernet:
    '<path d="M7 3h10v7H7zM9 10v3h6v-3M12 13v3M5 16h14v5H5z"/><path d="M8 18v3M12 18v3M16 18v3"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z"/><path d="M3 9h18"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
  library: '<path d="M5 4v16M10 4v16M15 5v15M19 4v16"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  next: '<path d="m8 5 8 7-8 7V5Z"/><path d="M18 5v14"/>',
  nowPlaying: '<path d="M5 9v6M9 6v12M13 4v16M17 7v10M21 10v4"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  previous: '<path d="m16 5-8 7 8 7V5Z"/><path d="M6 5v14"/>',
  queue: '<path d="M4 6h12M4 12h12M4 18h8"/><path d="m18 15 3 3-3 3"/>',
  repeat:
    '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  shuffle:
    '<path d="M4 7h3c4 0 6 10 10 10h3"/><path d="m17 14 3 3-3 3M4 17h3c1.5 0 2.7-1.4 3.8-3M15 7c.7-.6 1.3-1 2.2-1H20"/><path d="m17 3 3 3-3 3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  sources:
    '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  usb: '<path d="M12 3v14M12 3l-2.5 2.5M12 3l2.5 2.5M12 10l-4-2M8 8v7M8 15a2 2 0 1 0 0 4M12 13l4-2M16 11v4"/><rect x="14.5" y="15" width="3" height="3"/>',
  volume:
    '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11"/>',
  volumeMuted:
    '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 10 5 5M21 10l-5 5"/>',
  wifi: '<path d="M3.5 9a13 13 0 0 1 17 0M6.5 12.5a8.5 8.5 0 0 1 11 0M9.5 16a4 4 0 0 1 5 0"/><circle cx="12" cy="19" r=".75" fill="currentColor" stroke="none"/>',
};

export function icon(name: IconName, className = "icon"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}
