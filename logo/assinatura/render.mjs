import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage}=require('/home/augusto/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const out=new URL('./',import.meta.url);
const gold='#EABB75', ink='#111215', white='#F6F3ED';
// Derived from MyBots: broad superellipse body, feline tips, two round empty eyes, no mouth.
const outline='M 99 173 C 98 137 100 87 110 47 Q 114 33 121 48 L 170 150 C 218 138 294 138 342 150 L 391 48 Q 398 33 402 47 C 412 87 414 137 413 173 C 441 199 448 237 448 298 C 448 386 443 421 414 444 C 386 467 333 470 256 470 C 179 470 126 467 98 444 C 69 421 64 386 64 298 C 64 237 71 199 99 173 Z';
const eyes='M 220 284 A 39 44 0 1 0 142 284 A 39 44 0 1 0 220 284 Z M 370 284 A 39 44 0 1 0 292 284 A 39 44 0 1 0 370 284 Z';
const symbol=(color=gold)=>`<path fill="${color}" fill-rule="evenodd" d="${outline} ${eyes}"/>`;
// Custom rounded monoline lettering, all paths: no font dependency.
const letters=`<path d="M 0 100 V 42 M 0 62 C 0 31 46 31 46 62 V 100 M 46 62 C 46 31 92 31 92 62 V 100 M 124 42 L 151 100 M 178 42 L 141 126 Q 136 138 123 138 M 211 15 V 100 M 211 70 C 211 30 269 30 269 70 C 269 110 211 110 211 70 M 300 70 C 300 30 358 30 358 70 C 358 110 300 110 300 70 M 397 20 V 82 Q 397 100 417 100 M 381 43 H 419 M 495 47 C 480 34 447 37 447 55 C 447 76 497 65 497 85 C 497 105 465 107 447 95"/>`;
const word=(color)=>`<g fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">${letters}</g>`;
const svg=(w,h,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>mybots — assinatura</title>${body}</svg>`;
async function save(name,source,w,h){await writeFile(new URL(name+'.svg',out),source);const c=createCanvas(w,h);c.getContext('2d').drawImage(await loadImage(Buffer.from(source)),0,0,w,h);await writeFile(new URL(name+'.png',out),c.toBuffer('image/png'));return c;}
await save('simbolo',svg(512,512,symbol()),2048,2048);
await save('simbolo-monocromatico',svg(512,512,symbol(ink)),2048,2048);
await save('icone',svg(512,512,`<rect width="512" height="512" rx="112" fill="${ink}"/><g transform="translate(51 45) scale(.8)">${symbol()}</g>`),2048,2048);
const lockup=(color,bg='')=>svg(1360,512,`${bg}<g transform="translate(30 35) scale(.84)">${symbol()}</g><g transform="translate(525 151) scale(1.48)">${word(color)}</g>`);
await save('logo-transparente',lockup(ink),4080,1536);
await save('logo-negativa',lockup(white),4080,1536);
await save('logo-escura',lockup(white,`<rect width="1360" height="512" fill="${ink}"/>`),4080,1536);
await save('previa',svg(1600,1000,`<rect width="1600" height="1000" fill="${ink}"/><g transform="translate(544 80)">${symbol()}</g><g transform="translate(402 665) scale(1.6)">${word(white)}</g>`),1600,1000);
await writeFile(new URL('LEIA-ME.txt',out),`MYBOTS — ASSINATURA\n\nSímbolo derivado do bot MyBots do aplicativo: corpo largo, duas pontas, olhos redondos vazados e ausência de boca.\nA marca compacta usa uma silhueta sólida; a versão de partículas continua como expressão animada do personagem.\n\nDourado ${gold}; fundo ${ink}; texto claro ${white}.\nSVGs vetoriais com letras desenhadas em curvas, sem dependência de fontes.\nPNGs: símbolo/ícone 2048px; assinatura horizontal 4080×1536.\nUsar logo-transparente em fundos claros e logo-negativa em fundos escuros.\nMargem livre recomendada: ao menos o diâmetro de um olho.\nEm tamanhos pequenos usar apenas o símbolo.\nOs arquivos do aplicativo não foram substituídos.\n`);
