// Makes the computer's self-signed certificate (EC P-256, 10 years) in JavaScript, the same on every system (no openssl).
// Run as a separate small process by identity() in server.mjs, which is synchronous: `node make-cert.mjs <key.pem> <cert.pem>`.
import { writeFileSync, chmodSync } from 'node:fs';
import selfsigned from 'selfsigned';

const [key, cert] = process.argv.slice(2);
if (!key || !cert) { console.error('Uso: make-cert.mjs <chave.pem> <certificado.pem>'); process.exit(2); }
const pems = await selfsigned.generate([{ name: 'commonName', value: 'mybots-pc' }], { keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notAfterDate: new Date(Date.now() + 3650 * 86400000) });
writeFileSync(key, pems.private, { mode: 0o600 }); chmodSync(key, 0o600); writeFileSync(cert, pems.cert);
