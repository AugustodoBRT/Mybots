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
module.exports = { FEED, RELEASE_PAGE, feedFile, feedVersion, isNewer, updatesItself };
