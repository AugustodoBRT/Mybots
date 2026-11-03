// electron-builder leaves out node_modules folders nested in the app (pc/, supervisor/, mobile/). The code finds its
// dependencies there, exactly as in the repository, so they are copied in after packing, before the installers are made.
const { cpSync, existsSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async context => {
  const stage = join(context.packager.info.appDir);
  const app = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app')
    : join(context.appOutDir, 'resources', 'app');
  const found = [];
  const walk = (relative) => {
    for (const name of readdirSync(join(stage, relative))) {
      const path = join(relative, name); const full = join(stage, path);
      if (!statSync(full).isDirectory()) continue;
      if (name === 'node_modules') { cpSync(full, join(app, path), { recursive: true }); found.push(path); } else walk(path);
    }
  };
  for (const top of ['pc', 'supervisor', 'mobile', 'relay']) if (existsSync(join(stage, top))) walk(top);
  if (!found.length) throw new Error('Nenhum node_modules encontrado para copiar para o app.');
  console.log(`  • afterPack: copiados ${found.join(', ')}`);
};
