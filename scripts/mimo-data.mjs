// Writes the tables of the particle bots for the phone's Kotlin port (run by npm test; the test checks the file is current).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nativeData } from '../lib/mimo.mjs';
const out = resolve(import.meta.dirname, '../mobile/modules/termux-bridge/android/src/main/assets/mimo-data.json');
writeFileSync(out, JSON.stringify(nativeData()) + '\n'); console.log('mimo-data.json escrito.');
