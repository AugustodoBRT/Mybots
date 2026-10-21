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
  document.title = 'MyBots'; document.body.style.backgroundColor = '#090B10';
  const style = document.createElement('style');
  style.textContent = '::-webkit-scrollbar{width:10px;background:transparent}::-webkit-scrollbar-thumb{background:#2A3140;border-radius:5px}';
  document.head.appendChild(style);
}
