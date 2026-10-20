import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MOBILE = join(ROOT, 'mobile');
const PORT = Number(process.env.PORT || 3210);

async function findExpoPort(start = 8081) {
  for (let port = start; port < start + 20; port++) {
    const free = await new Promise(resolve => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '0.0.0.0', () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('Não encontrei uma porta livre para o Expo. Feche outros servidores Expo e tente novamente.');
}

function interfaceAddress() {
  try {
    for (const [name, entries] of Object.entries(networkInterfaces())) {
      if (/^(lo|docker|br-|veth|virbr|tun|tap|tailscale)/i.test(name)) continue;
      const entry = entries?.find(item => item.family === 'IPv4' && !item.internal);
      if (entry) return entry.address;
    }
  } catch { /* Some isolated shells do not expose network interface details. */ }
}

function lanAddress() {
  return new Promise(resolve => {
    const socket = createSocket('udp4');
    socket.once('error', () => { socket.close(); resolve(interfaceAddress()); });
    socket.connect(9, '192.0.2.1', () => {
      const address = socket.address().address;
      socket.close();
      resolve(address === '0.0.0.0' ? interfaceAddress() : address);
    });
  });
}

const address = await lanAddress();
if (!address || address.startsWith('127.')) {
  console.error('Conecte o computador à rede Wi-Fi e tente iniciar o MyBots novamente.');
  process.exit(1);
}
if (PORT < 1024 || PORT > 65535) throw new Error('PORT deve ficar entre 1024 e 65535.');

const token = randomBytes(32).toString('hex');
const expoPort = await findExpoPort();
const backend = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
  cwd: ROOT, stdio: 'inherit',
  env: { ...process.env, PORT: String(PORT), MYBOTS_BIND: address, MYBOTS_HOST: address,
    MYBOTS_TOKEN: token, MYBOTS_MOBILE: '1' }
});
let stopping = false;
let expo;
const stop = () => {
  if (stopping) return;
  stopping = true;
  backend.kill('SIGTERM');
  expo?.kill('SIGTERM');
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
backend.once('exit', code => {
  if (!stopping && code !== 0) process.exitCode = code || 1;
  stop();
});

let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  if (stopping || backend.exitCode !== null) process.exit(1);
  try {
    const response = await fetch(`http://${address}:${PORT}/api/state`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) { ready = true; break; }
  } catch { /* The backend is still starting. */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) {
  console.error(`O servidor local não respondeu. Confira se a porta ${PORT} está livre e tente novamente.`);
  stop();
  process.exit(1);
}

const cli = join(MOBILE, 'node_modules', 'expo', 'bin', 'cli');
const expoEnv = { ...process.env, EXPO_PUBLIC_MYBOTS_API_URL: `http://${address}:${PORT}`,
  EXPO_NO_QR_CODE: '1' };
delete expoEnv.PORT;
expo = spawn(process.execPath, [cli, 'start', '--lan', '--go', '--port', String(expoPort)], {
  cwd: MOBILE, stdio: 'inherit',
  env: expoEnv
});
expo.once('error', error => { console.error('Não foi possível iniciar o Expo:', error.message); stop(); });
expo.once('exit', code => {
  if (!stopping && code !== 0) process.exitCode = code || 1;
  stop();
});
let metroReady = false;
for (let attempt = 0; attempt < 120; attempt++) {
  if (stopping || expo.exitCode !== null) { stop(); process.exit(1); }
  try {
    const response = await fetch(`http://127.0.0.1:${expoPort}/_expo/open?platform=android&runtime=expo`);
    if (response.ok) { metroReady = true; break; }
  } catch { /* Metro is still starting. */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!metroReady) {
  console.error('O Expo não iniciou a tempo. Confira a saída acima e tente novamente.');
  stop();
  process.exit(1);
}

const qrUrl = `exp://${address}:${expoPort}/--/?token=${token}&api=${encodeURIComponent(`http://${address}:${PORT}`)}`;
const qrFile = join(MOBILE, '.expo', 'mybots-qr.png');
await mkdir(join(MOBILE, '.expo'), { recursive: true });
await createRequire(join(MOBILE, 'package.json'))('qrcode').toFile(qrFile, qrUrl, {
  errorCorrectionLevel: 'H', margin: 4, width: 512, color: { dark: '#17251E', light: '#FFFFFF' }
});
console.log(`\n  QR do MyBots pronto para abrir no Expo Go: ${qrFile}\n  Use este QR; ele autoriza o app nesta sessão.\n`);
