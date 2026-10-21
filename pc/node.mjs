#!/usr/bin/env node
// O MyBots no computador. Uso:
//   node pc/node.mjs            roda o nó (o celular pareado conecta sozinho)
//   node pc/node.mjs pair       mostra o QR para parear o celular (vale 10 minutos, uma vez)
//   node pc/node.mjs install    inicia o nó junto com a sessão (serviço systemd do usuário)
//   node pc/node.mjs uninstall  remove o início automático
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createNode, startPairing, DEFAULT_PORT } from './server.mjs';

const directory = process.env.MYBOTS_PC_HOME || join(homedir(), '.mybots-pc');
const port = Number(process.env.MYBOTS_PC_PORT) || DEFAULT_PORT;
const unit = join(homedir(), '.config', 'systemd', 'user', 'mybots-pc.service');
const stamp = () => new Date().toLocaleTimeString('pt-BR');
const systemctl = (...args) => execFileSync('systemctl', ['--user', ...args], { stdio: 'inherit' });

async function serve() {
  const node = await createNode({ directory, port, log: line => console.log(`[${stamp()}] ${line}`) });
  console.log(`[${stamp()}] MyBots no computador "${node.name}" esperando o celular na porta ${node.port}.`);
  if (!node.phones().length) console.log('Nenhum celular pareado ainda. Em outro terminal: node pc/node.mjs pair');
  const stop = () => node.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

async function pair() {
  const { link, name } = startPairing(directory, port);
  const { default: QRCode } = await import('qrcode');
  console.log(await QRCode.toString(link, { type: 'terminal', small: true, errorCorrectionLevel: 'L' }));
  console.log(`No celular: MyBots → Ajustes → Computador → Conectar computador, e leia este QR (${name}).`);
  console.log('Vale por 10 minutos e uma vez só. O nó precisa estar rodando (node pc/node.mjs ou o serviço instalado).');
}

function install() {
  mkdirSync(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
  // The PATH of this shell goes along, so the service finds claude and codex like the terminal does.
  writeFileSync(unit, `[Unit]
Description=MyBots no computador
After=network-online.target

[Service]
ExecStart=${process.execPath} ${fileURLToPath(import.meta.url)}
Environment=PATH=${process.env.PATH}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`);
  systemctl('daemon-reload'); systemctl('enable', '--now', 'mybots-pc.service');
  console.log('Pronto: o MyBots sobe sozinho quando você entra no computador. Logs: journalctl --user -u mybots-pc -f');
}

function uninstall() {
  if (existsSync(unit)) { systemctl('disable', '--now', 'mybots-pc.service'); unlinkSync(unit); systemctl('daemon-reload'); }
  console.log('Início automático removido.');
}

const command = process.argv[2] || 'serve';
const commands = { serve, pair, install, uninstall };
if (!commands[command]) { console.error(`Comando desconhecido: ${command}. Use pair, install ou uninstall.`); process.exit(1); }
Promise.resolve(commands[command]()).catch(error => { console.error(error.message); process.exit(1); });
