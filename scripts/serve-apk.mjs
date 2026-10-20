import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const apk = fileURLToPath(new URL('../dist/apk/mybots-v29.apk', import.meta.url));
const qrFile = fileURLToPath(new URL('../mobile/.expo/mybots-v29-qr.png', import.meta.url));
const port = Number(process.env.MYBOTS_APK_PORT || 48767);
const interfaces = networkInterfaces();
const address = Object.entries(interfaces).flatMap(([name, values]) => values.map(value => ({ name, ...value })))
  .find(value => !value.internal && value.family === 'IPv4' && !/^(docker|br-|veth)/.test(value.name))?.address;
if (!address) throw new Error('Não encontrei o endereço da rede local.');
const size = statSync(apk).size;
const server = createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method) || request.url !== '/mybots-v29.apk') {
    response.writeHead(404).end(); return;
  }
  response.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': size,
    'Content-Disposition': 'attachment; filename="MyBots-v29.apk"', 'Cache-Control': 'no-store' });
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = createReadStream(apk);
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
const url = `http://${address}:${port}/mybots-v29.apk`;
await createRequire(new URL('../mobile/package.json', import.meta.url))('qrcode').toFile(qrFile, url, { width: 420, margin: 2 });
console.log(JSON.stringify({ url, qrFile, size }));
