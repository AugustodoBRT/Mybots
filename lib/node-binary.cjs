// The program that runs JavaScript for the MyBots' own helpers (the tools server the IAs start, the computer's own supervisor).
// Installed app: the Electron binary is the only Node there is, so the app puts a small launcher (ELECTRON_RUN_AS_NODE) in
// MYBOTS_NODE; elsewhere it is simply this process's own Node.
const nodeBinary = () => process.env.MYBOTS_NODE || process.execPath;
/**
 * What MyBots' own children start for JavaScript. Node cannot start a .cmd without a shell, and on Windows the app's launcher is one,
 * so there the program is this process's own (Electron, or Node) run as plain Node. Harmless on a real Node.
 */
const nodeRun = (env = process.env) => {
  const launcher = env.MYBOTS_NODE;
  return launcher && !/\.(cmd|bat)$/i.test(launcher) ? { command: launcher, env: null } : { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
};
module.exports = { nodeBinary, nodeRun };
