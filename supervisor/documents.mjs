import { inflateRawSync } from 'node:zlib';

// Office files (docx, xlsx, pptx) are ZIP archives of XML. Reading them needs no library: the central directory
// lists the entries and Node inflates them. Limits keep a hostile file (a "zip bomb") from exhausting the phone.
const LIMITS = { entries: 3000, entry: 30 * 1024 * 1024, total: 60 * 1024 * 1024 };

export function unzip(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('O arquivo está corrompido ou não é um documento do Office.');
  const count = bytes.readUInt16LE(end + 10); let offset = bytes.readUInt32LE(end + 16);
  if (count > LIMITS.entries) throw new Error('O documento tem partes demais.');
  const entries = new Map(); let total = 0;
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('O arquivo está corrompido.');
    const method = bytes.readUInt16LE(offset + 10), compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extra + comment;
    if (size > LIMITS.entry || (total += size) > LIMITS.total) throw new Error('O documento é grande demais para ler.');
    entries.set(name, () => {
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const data = bytes.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: LIMITS.entry });
      throw new Error('Compressão de documento não suportada.');
    });
  }
  return { names: [...entries.keys()], text: name => entries.has(name) ? entries.get(name)().toString('utf8') : null };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => code[0] === '#'
  ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : ENTITIES[code] ?? match);
const cell = value => value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const table = rows => {
  if (!rows.length) return '';
  const width = Math.max(...rows.map(row => row.length));
  const full = rows.map(row => [...row, ...Array(width - row.length).fill('')].map(cell));
  return [`| ${full[0].join(' | ')} |`, `| ${full[0].map(() => '---').join(' | ')} |`, ...full.slice(1).map(row => `| ${row.join(' | ')} |`)].join('\n');
};

// Word: paragraphs (headings and list items marked), tables as Markdown tables.
function docx(zip) {
  const xml = zip.text('word/document.xml');
  if (xml === null) throw new Error('Este .docx não tem o texto principal.');
  const paragraph = p => {
    const text = decode([...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br)\/>/g)].map(m => m[1] ?? (m[2] === 'tab' ? '\t' : '\n')).join(''));
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] || '';
    const heading = /^(Heading|Ttulo|Titulo|Título)(\d)/i.exec(style) || (/^Title$/i.test(style) ? [0, 0, '1'] : null);
    if (!text.trim()) return '';
    if (heading) return '#'.repeat(Math.min(6, Number(heading[2]) || 1)) + ' ' + text.trim();
    if (/<w:numPr>/.test(p)) return '- ' + text.trim();
    return text;
  };
  // Top-level tables and paragraphs, in document order (paragraphs inside a table belong to it).
  const rows = tbl => [...tbl.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map(tr =>
    [...tr[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map(tc => [...tc[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)].map(p => paragraph(p[0])).join(' ')));
  return [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)].map(m => m[0].startsWith('<w:tbl>') ? table(rows(m[0])) : paragraph(m[0])).filter(line => line.trim()).join('\n\n');
}

// Excel: every sheet as a Markdown table (first 300 rows × 40 columns), with the sheet names.
function xlsx(zip) {
  const strings = [...(zip.text('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => decode([...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(t => t[1]).join('')));
  const workbook = zip.text('xl/workbook.xml') || '';
  const rels = Object.fromEntries([...(zip.text('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map(m => [m[1], m[2]]));
  const sheets = [...workbook.matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map(m => ({ name: decode(m[1]), path: 'xl/' + (rels[m[2]] || '').replace(/^\/?xl\//, '') }));
  const column = ref => [...ref.replace(/\d+/g, '')].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return sheets.map(sheet => {
    const xml = zip.text(sheet.path) || ''; const rows = [];
    for (const row of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= 300) break;
      const values = [];
      for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const index = column(/r="([A-Z]+)\d+"/.exec(c[1])?.[1] || 'A'); if (index >= 40) continue;
        const type = /t="(\w+)"/.exec(c[1])?.[1]; const raw = /<v>([^<]*)<\/v>/.exec(c[2] || '')?.[1];
        values[index] = type === 's' ? strings[Number(raw)] ?? '' : type === 'inlineStr' ? decode([...(c[2] || '').matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join('')) : type === 'b' ? (raw === '1' ? 'VERDADEIRO' : 'FALSO') : decode(raw ?? '');
      }
      if (values.some(value => value !== undefined && value !== '')) rows.push([...values].map(value => value ?? ''));
    }
    return `## Planilha: ${sheet.name}\n\n${rows.length ? table(rows) : '(vazia)'}`;
  }).join('\n\n');
}

// PowerPoint: the text of each slide, in order.
function pptx(zip) {
  const slides = zip.names.filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  return slides.map((name, index) => `## Slide ${index + 1}\n\n` + [...zip.text(name).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
    .map(p => decode([...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(t => t[1]).join(''))).filter(line => line.trim()).join('\n')).join('\n\n');
}

export const OFFICE = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': docx,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': xlsx,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': pptx
};
const BY_NAME = { docx, xlsx, pptx };

/** The text of an Office document, or null when the file is not one. */
export function officeText(bytes, mime, name) {
  const reader = OFFICE[mime] || BY_NAME[/\.(docx|xlsx|pptx)$/i.exec(name)?.[1].toLowerCase()];
  return reader ? reader(unzip(bytes)) : null;
}
