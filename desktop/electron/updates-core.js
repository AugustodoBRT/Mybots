// The pure part of the window's updates: reading the feed's version and comparing versions.
const FEED = 'https://github.com/AugustodoBRT/Mybots/releases/download/pc-latest';
const RELEASE_PAGE = 'https://github.com/AugustodoBRT/Mybots/releases/tag/pc-latest';
const feedFile = (platform, arch) => platform === 'win32' ? 'latest.yml' : platform === 'darwin' ? 'latest-mac.yml' : arch === 'arm64' ? 'latest-linux-arm64.yml' : 'latest-linux.yml';
/** The `version:` of an electron-builder feed file (latest*.yml). */
const feedVersion = text => { const match = /^version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m.exec(String(text || '')); return match ? match[1] : null; };
/** Is `candidate` a newer x.y.z than `current`? */
function isNewer(candidate, current) {
  const a = String(candidate).split('.').map(Number), b = String(current).split('.').map(Number);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
/** AppImage and Windows installs update themselves; .deb and macOS (not signed) only tell about the new version. */
const updatesItself = (platform, env = process.env) => platform === 'win32' || (platform === 'linux' && Boolean(env.APPIMAGE));

/**
 * The window's update, one step at a time: none → available (a button) → downloading (percent) → installing (it restarts by itself).
 * A failure goes back to the button with the reason; a new "available" never interrupts a download that is going on.
 */
const IDLE = { phase: 'none', version: null, percent: 0, error: null };
function nextState(state, event) {
  const busy = state.phase === 'downloading' || state.phase === 'installing';
  switch (event.type) {
    case 'none': return busy ? state : { ...IDLE };
    case 'available': return busy ? state : { phase: 'available', version: event.version, percent: 0, error: null };
    case 'start': return { ...state, phase: 'downloading', percent: 0, error: null };
    case 'progress': return state.phase === 'installing' ? state : { ...state, phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(Number(event.percent) || 0))) };
    case 'downloaded': return { ...state, phase: 'installing', percent: 100, error: null };
    case 'error': return { ...state, phase: state.version ? 'available' : 'none', percent: 0, error: String(event.message || 'Não consegui atualizar.').slice(0, 200) };
    default: return state;
  }
}
module.exports = { FEED, RELEASE_PAGE, feedFile, feedVersion, isNewer, updatesItself, nextState, IDLE };
