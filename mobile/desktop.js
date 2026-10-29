import { Platform } from 'react-native';

// The MyBots window on the computer: the page served by the computer's node carries its local connection
// (port and token). Everything else in the app keeps working as on the phone, through the phone's supervisor.
export const desktop = Platform.OS === 'web' && globalThis.MYBOTS_DESKTOP?.token ? globalThis.MYBOTS_DESKTOP : null;
// On the computer, sheets open as centered dialogs instead of rising from the bottom.
export const dialogBackdrop = desktop ? { justifyContent: 'center', paddingVertical: 28, paddingHorizontal: 20 } : {};
export const dialogShape = desktop ? { borderRadius: 26, borderWidth: 1 } : {};
export const noHandle = desktop ? { display: 'none' } : {};
// A wide window keeps the phone's layout as one centered column, sheets included.
export const column = desktop ? { width: '100%', maxWidth: 820, marginHorizontal: 'auto' } : {};
if (desktop) {
  document.title = 'MyBots'; document.body.style.backgroundColor = '#000000';
  const style = document.createElement('style'); style.id = 'mybots-scroll';
  style.textContent = '::-webkit-scrollbar{width:10px;background:transparent}::-webkit-scrollbar-thumb{background:#37373F;border-radius:5px}';
  document.head.appendChild(style);
}
// The window's page background and scrollbar follow the theme (the app's own views are repainted by React).
export function paintPage(colors) {
  if (!desktop) return;
  document.body.style.backgroundColor = colors.bg; document.documentElement.style.colorScheme = colors.dark ? 'dark' : 'light';
  const style = document.getElementById('mybots-scroll'); if (style) style.textContent = `::-webkit-scrollbar{width:10px;background:transparent}::-webkit-scrollbar-thumb{background:${colors.line2};border-radius:5px}`;
}

// Small messages between the window's shell and the open conversation (for example "open the browser panel").
const listeners = new Map();
export const desktopBus = {
  on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
  emit(name, value) { listeners.get(name)?.forEach(fn => fn(value)); }
};
// Conversation text and the message field stay in a calm column of about 760 px.
export const readingColumn = desktop ? { width: '100%' } : {};
