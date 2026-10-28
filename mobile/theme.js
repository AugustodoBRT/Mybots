import React from 'react';
import Svg, { Path, Circle, Rect, Line, Polyline } from 'react-native-svg';

// MyBots design tokens. A quiet, deep background; each bot's color appears only where it matters
// (who is working, what needs you), the way agent apps signal state with light instead of text.
export const C = {
  bg: '#090B10', bg2: '#0D1016', surface: '#12161E', surface2: '#181D27', elevated: '#1E2430',
  line: '#232937', line2: '#2F3747', text: '#F3F5F9', text2: '#C9CFDA', muted: '#8B94A6', faint: '#5E6779',
  mint: '#7EE2B8', mintInk: '#0F2A1F', sky: '#8AB6FF', lilac: '#C2A5FF', peach: '#FFB38A', amber: '#FFC86E', amberInk: '#2E2210', red: '#FF8E8E'
};
export const HUES = { green: C.mint, blue: C.sky, purple: C.lilac, orange: C.peach };
export const F = {
  r: 'PlusJakartaSans_400Regular', m: 'PlusJakartaSans_500Medium', s: 'PlusJakartaSans_600SemiBold',
  b: 'PlusJakartaSans_700Bold', x: 'PlusJakartaSans_800ExtraBold'
};
export const R = { s: 10, m: 14, l: 20, xl: 26 };

// Line icons on a 24 grid, drawn for MyBots (rounded caps, 1.8 stroke).
const ICONS = {
  bots: [['rect', { x: 4, y: 8, width: 16, height: 12, rx: 4.5 }], ['path', { d: 'M12 4.5V8' }], ['circle', { cx: 12, cy: 3.6, r: 1.3, fill: true }], ['circle', { cx: 9.2, cy: 14, r: 1.3, fill: true }], ['circle', { cx: 14.8, cy: 14, r: 1.3, fill: true }]],
  activity: [['polyline', { points: '3 12.5 7 12.5 10 5 14 19 17 12.5 21 12.5' }]],
  settings: [['path', { d: 'M4 6.5h16M4 12h16M4 17.5h16' }], ['circle', { cx: 9, cy: 6.5, r: 2.2, solid: true }], ['circle', { cx: 15.5, cy: 12, r: 2.2, solid: true }], ['circle', { cx: 7.5, cy: 17.5, r: 2.2, solid: true }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  wallet: [['rect', { x: 3, y: 5.5, width: 18, height: 13, rx: 2.8 }], ['path', { d: 'M3 10h18M7 14.5h3.2' }]],
  back: [['polyline', { points: '15 18 9 12 15 6' }]],
  right: [['polyline', { points: '9 6 15 12 9 18' }]],
  down: [['polyline', { points: '6 9.5 12 15.5 18 9.5' }]],
  more: [['circle', { cx: 5.5, cy: 12, r: 1.6, fill: true }], ['circle', { cx: 12, cy: 12, r: 1.6, fill: true }], ['circle', { cx: 18.5, cy: 12, r: 1.6, fill: true }]],
  globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3c2.6 2.7 3.8 5.7 3.8 9s-1.2 6.3-3.8 9c-2.6-2.7-3.8-5.7-3.8-9S9.4 5.7 12 3z' }]],
  clip: [['path', { d: 'M20.5 11.6l-8.3 8.3a5.2 5.2 0 0 1-7.4-7.4l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.4 8.4a1.9 1.9 0 0 1-2.7-2.7l7.6-7.6' }]],
  mic: [['rect', { x: 9, y: 3, width: 6, height: 11.5, rx: 3 }], ['path', { d: 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21' }]],
  send: [['path', { d: 'M12 19V5.5M6 11l6-6 6 6' }]],
  close: [['path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' }]],
  check: [['polyline', { points: '5 12.5 10 17.5 19 7' }]],
  bell: [['path', { d: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 1.8H4.2zM10 21h4' }]],
  refresh: [['path', { d: 'M20 12a8 8 0 1 1-2.4-5.7' }], ['polyline', { points: '20 4 20 9 15 9' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7.5V12l3 2' }]],
  spark: [['path', { d: 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z' }]],
  shield: [['path', { d: 'M12 3l7.5 3v5.7c0 4.6-3.1 7.9-7.5 9.3-4.4-1.4-7.5-4.7-7.5-9.3V6z' }], ['polyline', { points: '8.8 12 11.2 14.4 15.4 9.8' }]],
  file: [['path', { d: 'M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z' }], ['polyline', { points: '14 3 14 8 19 8' }]],
  download: [['path', { d: 'M12 4v11M7 10.5l5 5 5-5M5 20h14' }]],
  share: [['circle', { cx: 17.5, cy: 5.5, r: 2.5 }], ['circle', { cx: 6.5, cy: 12, r: 2.5 }], ['circle', { cx: 17.5, cy: 18.5, r: 2.5 }], ['path', { d: 'M8.7 10.8l6.6-4M8.7 13.2l6.6 4' }]],
  open: [['path', { d: 'M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10' }]],
  phone: [['rect', { x: 6.5, y: 2.5, width: 11, height: 19, rx: 2.8 }], ['path', { d: 'M10.5 18.2h3' }]],
  search: [['circle', { cx: 11, cy: 11, r: 6.5 }], ['path', { d: 'M16 16l4.5 4.5' }]],
  laptop: [['rect', { x: 4.5, y: 5, width: 15, height: 10.5, rx: 2 }], ['path', { d: 'M2.5 19h19' }]],
  battery: [['rect', { x: 3, y: 7.5, width: 15.5, height: 9, rx: 2.2 }], ['path', { d: 'M21 11v2M6 10.5v3' }]],
  list: [['path', { d: 'M9.5 6.5H20M9.5 12H20M9.5 17.5H20' }], ['circle', { cx: 5, cy: 6.5, r: 1.2, fill: true }], ['circle', { cx: 5, cy: 12, r: 1.2, fill: true }], ['circle', { cx: 5, cy: 17.5, r: 1.2, fill: true }]],
  trash: [['path', { d: 'M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 12.2a1.8 1.8 0 0 0 1.8 1.8h5.6a1.8 1.8 0 0 0 1.8-1.8L17.5 7M9.5 7V4.5h5V7' }]],
  edit: [['path', { d: 'M4 20h4.2L19.4 8.8a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8z' }]],
  apps: [['rect', { x: 4, y: 4, width: 7, height: 7, rx: 2 }], ['rect', { x: 13, y: 4, width: 7, height: 7, rx: 2 }], ['rect', { x: 4, y: 13, width: 7, height: 7, rx: 2 }], ['rect', { x: 13, y: 13, width: 7, height: 7, rx: 2 }]],
  mail: [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }], ['polyline', { points: '3.5 7 12 13 20.5 7' }]],
  calendar: [['rect', { x: 4, y: 5, width: 16, height: 16, rx: 2.5 }], ['path', { d: 'M8 3v4M16 3v4M4 10h16' }]],
  bolt: [['path', { d: 'M13 3L5 14h6.2L10 21l8-11h-6.2z' }]],
  user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4.5 20.5a7.5 7.5 0 0 1 15 0' }]],
  hand: [['path', { d: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6.5 7-3 0-4.5-1.5-6-4l-1.6-2.8a1.5 1.5 0 0 1 2.6-1.5L8 15' }]],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v5.5' }], ['circle', { cx: 12, cy: 7.8, r: 1.1, fill: true }]],
  alert: [['path', { d: 'M12 4l9 16H3z' }], ['path', { d: 'M12 10v4.5' }], ['circle', { cx: 12, cy: 17.2, r: 1, fill: true }]],
  stop: [['rect', { x: 6.5, y: 6.5, width: 11, height: 11, rx: 2.5 }]],
  memory: [['path', { d: 'M9 4.5a3 3 0 0 0-3 3v.3A3.2 3.2 0 0 0 4 11a3.2 3.2 0 0 0 1.4 2.7A3.2 3.2 0 0 0 9 19.5h.5V4.5zM15 4.5a3 3 0 0 1 3 3v.3a3.2 3.2 0 0 1 2 3.2 3.2 3.2 0 0 1-1.4 2.7A3.2 3.2 0 0 1 15 19.5h-.5V4.5z' }]],
  wifi: [['path', { d: 'M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9 16.4a4 4 0 0 1 6 0' }], ['circle', { cx: 12, cy: 19.3, r: 1.1, fill: true }]],
  play: [['path', { d: 'M8 5.5v13l10.5-6.5z' }]],
  pause: [['path', { d: 'M9 5.5v13M15 5.5v13' }]],
  copy: [['rect', { x: 8, y: 8, width: 12, height: 12, rx: 2.5 }], ['path', { d: 'M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8' }]],
  key: [['circle', { cx: 8, cy: 15, r: 4 }], ['path', { d: 'M11 12l9-9M16.5 6.5l2.5 2.5M14.5 8.5l2 2' }]]
};

export function Icon({ name, size = 22, color = C.text2, stroke = 1.8 }) {
  const parts = ICONS[name] || ICONS.info;
  return <Svg width={size} height={size} viewBox="0 0 24 24">
    {parts.map(([type, props], index) => {
      const { fill, solid, ...rest } = props;
      const paint = fill ? { fill: color, stroke: 'none' } : { fill: solid ? C.bg : 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
      if (type === 'rect') return <Rect key={index} {...rest} {...paint} />;
      if (type === 'circle') return <Circle key={index} {...rest} {...paint} />;
      if (type === 'line') return <Line key={index} {...rest} {...paint} />;
      if (type === 'polyline') return <Polyline key={index} {...rest} {...paint} />;
      return <Path key={index} {...rest} {...paint} />;
    })}
  </Svg>;
}
