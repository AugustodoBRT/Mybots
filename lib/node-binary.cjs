// The program that runs JavaScript for the MyBots' own helpers (the tools server the IAs start, the computer's own supervisor).
// Installed app: the Electron binary is the only Node there is, so the app puts a small launcher (ELECTRON_RUN_AS_NODE) in
// MYBOTS_NODE; elsewhere it is simply this process's own Node.
module.exports = { nodeBinary: () => process.env.MYBOTS_NODE || process.execPath };
