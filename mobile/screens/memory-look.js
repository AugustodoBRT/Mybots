import { currentTheme } from '../theme';

// The memory area copies Obsidian's look: its default dark and light colours, the purple accent for links and
// highlights, quiet grey nodes and thin lines. Read at render, so a theme change repaints it.
const DARK = {
  bg: '#1e1e1e', panel: '#262626', panelBorder: '#363636', hover: '#2f2f2f', text: '#dadada', muted: '#a3a3a3', faint: '#666666',
  accent: '#a882ff', link: '#a88bfa', linkHover: '#c1b0ff', node: '#b3b3b3', line: '#4a4a4a', unresolved: '#5c5c5c',
  code: '#2a2a2a', quote: '#7f6df2', input: '#2a2a2a', danger: '#fb464c', shadow: 'rgba(0,0,0,0.45)'
};
const LIGHT = {
  bg: '#ffffff', panel: '#f6f6f6', panelBorder: '#e0e0e0', hover: '#ececec', text: '#222222', muted: '#5c5c5c', faint: '#ababab',
  accent: '#8a5cf5', link: '#705dcf', linkHover: '#8a5cf5', node: '#8a8a8a', line: '#cfcfcf', unresolved: '#c4c4c4',
  code: '#f3f3f3', quote: '#8a5cf5', input: '#ffffff', danger: '#e93147', shadow: 'rgba(0,0,0,0.12)'
};
export const look = () => currentTheme() === 'light' ? LIGHT : DARK;

// Well separated hues, one per bot, so two bots never share a colour on the map (until there are more than 12).
const DARK_HUES = ['#4fa3ff', '#ff6b6b', '#3fcf8e', '#ffb224', '#c792ff', '#22d3ee', '#ff7ac6', '#ff8c42', '#a3e635', '#8b9cff', '#f0d264', '#2dd4bf'];
const LIGHT_HUES = ['#1f6fd1', '#d93838', '#1f9d63', '#c47f00', '#8a4fdc', '#0e8fa8', '#d63f97', '#d9661c', '#5f8f12', '#4b5fd6', '#a68a00', '#0f9488'];
export function botHues(bots) {
  const hues = currentTheme() === 'light' ? LIGHT_HUES : DARK_HUES;
  const order = [...bots].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
  return new Map(order.map((bot, index) => [bot.id, hues[index % hues.length]]));
}
// Note types, Obsidian-style groups.
export const kindHues = () => currentTheme() === 'light'
  ? { chefe: '#8a5cf5', entrega: '#1f6fd1', arquivo: '#8a8a8a' } : { chefe: '#a882ff', entrega: '#4fa3ff', arquivo: '#8c8c8c' };
export const KIND_NAMES = { chefe: 'Chefe', entrega: 'Entregas', arquivo: 'Arquivo' };
