import { registerRootComponent } from 'expo';
// The bot's face over the browser (desktop/electron) is a page of its own: the same bundle, a tiny screen.
const overlay = globalThis.location?.search?.includes('overlay=1');
registerRootComponent(overlay ? require('./components/DesktopOverlay').OverlayApp : require('./App').default);
