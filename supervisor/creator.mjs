import { deflateRawSync } from 'node:zlib';
import { parseBlocks, parseInline, plainText } from '../mobile/markdown.js';
import { splitMath, texHtml, texOmml, texText, MATH_CSS } from './math.mjs';

// Files a bot makes from the Markdown it writes: PDF (HTML laid out by the phone), Word, Excel, CSV, Markdown,
// HTML and plain text. Office files are written as their XML parts in a ZIP, without any library.

export const FORMATS = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html'
};
const COLORS = ['#2F6FDE', '#E8743B', '#19A979', '#ED4A7B', '#945ECF', '#13A4B4'];
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const number = value => Number.isInteger(value) ? String(value) : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

// ---- Charts as SVG (PDF and HTML).
export function chartSvg(spec, width = 640, height = 320) {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" font-family="sans-serif" font-size="12">`];
  if (spec.title) parts.push(`<text x="${width / 2}" y="18" text-anchor="middle" font-size="15" font-weight="bold">${xml(spec.title)}</text>`);
  const top = spec.title ? 34 : 12;
  if (spec.type === 'pie') {
    const values = spec.series[0].data.map(value => Math.max(0, value)); const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = 150, cy = top + (height - top) / 2, r = Math.min(130, (height - top) / 2 - 8);
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      const sweep = value / total * Math.PI * 2; const end = angle + sweep;
      const path = sweep >= Math.PI * 2 - 1e-6 ? `<circle cx="${cx}" cy="${cy}" r="${r}"` : `<path d="M${cx},${cy} L${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)} A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(end)},${cy + r * Math.sin(end)} Z"`;
      parts.push(`${path} fill="${COLORS[index % COLORS.length]}" stroke="#fff"/>`);
      parts.push(`<rect x="310" y="${top + 8 + index * 22}" width="12" height="12" fill="${COLORS[index % COLORS.length]}"/><text x="328" y="${top + 18 + index * 22}">${xml(spec.labels[index])}: ${number(value)} (${Math.round(value / total * 100)}%)</text>`);
      angle = end;
    });
    return parts.join('') + '</svg>';
  }
  const legend = spec.series.length > 1 || spec.series[0].name;
  const left = 48, right = width - 12, bottom = height - (legend ? 46 : 28), plot = bottom - top;
  const values = spec.series.flatMap(item => item.data);
  const max = Math.max(0, ...values), min = Math.min(0, ...values); const span = max - min || 1;
  const y = value => bottom - (value - min) / span * plot;
  for (let step = 0; step <= 4; step++) {
    const value = min + span * step / 4;
    parts.push(`<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="#ddd"/><text x="${left - 6}" y="${y(value) + 4}" text-anchor="end" fill="#555">${number(Math.round(value * 100) / 100)}</text>`);
  }
  const slot = (right - left) / spec.labels.length;
  spec.labels.forEach((label, index) => parts.push(`<text x="${left + slot * (index + 0.5)}" y="${bottom + 16}" text-anchor="middle" fill="#333">${xml(label.length > 14 ? label.slice(0, 13) + '…' : label)}</text>`));
  spec.series.forEach((series, s) => {
    const color = COLORS[s % COLORS.length];
    if (spec.type === 'bar') {
      const bar = slot * 0.7 / spec.series.length;
      series.data.forEach((value, index) => { const x = left + slot * index + slot * 0.15 + bar * s; parts.push(`<rect x="${x}" y="${Math.min(y(value), y(0))}" width="${bar}" height="${Math.abs(y(0) - y(value))}" fill="${color}"/>`); });
    } else {
      const points = series.data.map((value, index) => `${left + slot * (index + 0.5)},${y(value)}`);
      parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`, ...points.map(point => `<circle cx="${point.split(',')[0]}" cy="${point.split(',')[1]}" r="3.5" fill="${color}"/>`));
    }
  });
  if (legend) spec.series.forEach((series, s) => parts.push(`<rect x="${left + s * 130}" y="${height - 16}" width="12" height="12" fill="${COLORS[s % COLORS.length]}"/><text x="${left + 18 + s * 130}" y="${height - 6}">${xml(series.name || `Série ${s + 1}`)}</text>`));
  return parts.join('') + '</svg>';
}

// ---- HTML (also the source of PDFs).
const inlineRuns = text => parseInline(text).map(run => {
  let value = xml(run.text).replace(/\n/g, '<br>');
  if (run.code) value = `<code>${value}</code>`;
  if (run.bold) value = `<strong>${value}</strong>`;
  if (run.italic) value = `<em>${value}</em>`;
  if (run.href) value = `<a href="${xml(run.href)}">${value}</a>`;
  return value;
}).join('');
// Formulas ($x^2$, $$…$$, \( … \), \[ … \]) are taken out first, so their _ and * are not read as Markdown.
const inlineHtml = text => splitMath(text).map(piece => piece.math ? texHtml(piece.math, piece.display) : inlineRuns(piece.text)).join('');

export function toHtml(markdown, title) {
  const body = parseBlocks(markdown, { keepMath: true }).map(block => {
    if (block.type === 'heading') return `<h${block.level}>${inlineHtml(block.text)}</h${block.level}>`;
    if (block.type === 'paragraph') return `<p>${inlineHtml(block.text)}</p>`;
    if (block.type === 'list') return `<${block.ordered ? `ol start="${block.start}"` : 'ul'}>${block.items.map(item => `<li>${inlineHtml(item)}</li>`).join('')}</${block.ordered ? 'ol' : 'ul'}>`;
    if (block.type === 'table') return `<table><thead><tr>${block.header.map(cell => `<th>${inlineHtml(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.map(cell => `<td>${inlineHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (block.type === 'code') return `<pre><code>${xml(block.text)}</code></pre>`;
    if (block.type === 'chart') return `<figure>${chartSvg(block.spec)}</figure>`;
    if (block.type === 'quote') return `<blockquote>${inlineHtml(block.text)}</blockquote>`;
    return '<hr>';
  }).join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${xml(title)}</title><style>
@page { size: A4; margin: 18mm 16mm; }
body { font-family: sans-serif; font-size: 11pt; line-height: 1.45; color: #1d1d1f; }
h1 { font-size: 19pt; margin: 0 0 10pt; } h2 { font-size: 15pt; margin: 16pt 0 6pt; } h3 { font-size: 12.5pt; margin: 12pt 0 4pt; }
h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
p, ul, ol { margin: 0 0 8pt; } li { margin: 2pt 0; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 12pt; page-break-inside: auto; } tr { page-break-inside: avoid; }
th, td { border: 1px solid #9aa0aa; padding: 4pt 6pt; text-align: left; vertical-align: top; } th { background: #eef1f6; }
code { font-family: monospace; background: #f2f3f5; padding: 0 2pt; } pre { background: #f2f3f5; padding: 8pt; white-space: pre-wrap; }
blockquote { border-left: 3pt solid #9aa0aa; margin: 0 0 8pt; padding-left: 8pt; color: #444; }
figure { margin: 8pt 0 12pt; page-break-inside: avoid; } a { color: #1a56c4; }
${MATH_CSS}
</style></head><body>
${body}
</body></html>`;
}

// ---- ZIP (stored entries are deflated), for Word and Excel.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xFFFFFFFF; for (const byte of bytes) c = CRC[(c ^ byte) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
export function zip(files) {
  const locals = []; const central = []; let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8'); const packed = deflateRawSync(data); const path = Buffer.from(name, 'utf8'); const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(path.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(path.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, path, packed); central.push(entry, path); offset += 30 + path.length + packed.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// ---- Word.
const textRuns = (text, extra = {}) => parseInline(text).map(run => {
  const style = [run.bold || extra.bold ? '<w:b/>' : '', run.italic ? '<w:i/>' : '', run.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '', run.href ? '<w:color w:val="1A56C4"/><w:u w:val="single"/>' : ''].join('');
  const content = (run.href && run.text !== run.href ? `${run.text} (${run.href})` : run.text).split('\n').map(line => `<w:t xml:space="preserve">${xml(line)}</w:t>`).join('<w:br/>');
  return `<w:r>${style ? `<w:rPr>${style}</w:rPr>` : ''}${content}</w:r>`;
}).join('');
// Formulas become native Word equations.
const runsDocx = (text, extra = {}) => splitMath(text).map(piece => piece.math ? texOmml(piece.math, piece.display) : textRuns(piece.text, extra)).join('');
const paragraphDocx = (text, { style, indent, prefix = '', bold } = {}) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${indent ? `<w:ind w:left="${indent}" w:hanging="300"/>` : ''}</w:pPr>${prefix ? `<w:r><w:t xml:space="preserve">${xml(prefix)}</w:t></w:r>` : ''}${runsDocx(text, { bold })}</w:p>`;
const tableDocx = (header, rows) => {
  const cell = (text, head) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF1F6"/>' : ''}</w:tcPr>${paragraphDocx(text, { bold: head })}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblStyle w:val="Tabela"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>${[header, ...rows].map((row, index) => `<w:tr>${row.map(text => cell(text, index === 0)).join('')}</w:tr>`).join('')}</w:tbl><w:p/>`;
};
export function toDocx(markdown, title) {
  const body = parseBlocks(markdown, { keepMath: true }).map(block => {
    if (block.type === 'heading') return paragraphDocx(block.text, { style: `Titulo${Math.min(block.level, 3)}` });
    if (block.type === 'paragraph') return paragraphDocx(block.text);
    if (block.type === 'list') return block.items.map((item, index) => paragraphDocx(item, { indent: 600, prefix: block.ordered ? `${block.start + index}.\t` : '•\t' })).join('');
    if (block.type === 'table') return tableDocx(block.header, block.rows);
    if (block.type === 'code') return block.text.split('\n').map(line => paragraphDocx('`' + line.replace(/`/g, "'") + '`')).join('');
    // Word charts need an embedded workbook; the data goes as a table with the chart's title.
    if (block.type === 'chart') return paragraphDocx(`**Gráfico${block.spec.title ? ': ' + block.spec.title : ''}**`) + tableDocx(['', ...block.spec.series.map((s, i) => s.name || `Série ${i + 1}`)], block.spec.labels.map((label, i) => [label, ...block.spec.series.map(s => number(s.data[i]))]));
    if (block.type === 'quote') return paragraphDocx(block.text, { style: 'Citacao' });
    return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="9AA0AA"/></w:pBdr></w:pPr></w:p>';
  }).join('');
  const heading = (id, name, size) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>MyBots</dc:creator></cp:coreProperties>`],
    ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading('Titulo1', 'heading 1', 36)}${heading('Titulo2', 'heading 2', 30)}${heading('Titulo3', 'heading 3', 25)}<w:style w:type="paragraph" w:styleId="Citacao"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="400"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style><w:style w:type="table" w:styleId="Tabela"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="9AA0AA"/><w:left w:val="single" w:sz="4" w:color="9AA0AA"/><w:bottom w:val="single" w:sz="4" w:color="9AA0AA"/><w:right w:val="single" w:sz="4" w:color="9AA0AA"/><w:insideH w:val="single" w:sz="4" w:color="9AA0AA"/><w:insideV w:val="single" w:sz="4" w:color="9AA0AA"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`]
  ]);
}

// ---- Excel: each table (and each chart's data) is a sheet named after the heading above it.
const plainInline = text => parseInline(text).map(run => run.text).join('');
const numeric = value => /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+([.,]\d+)?$/.test(value.trim()) ? Number(value.trim().replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) : null;
export function tablesOf(markdown) {
  const tables = []; let heading = '';
  for (const block of parseBlocks(markdown)) {
    if (block.type === 'heading') heading = plainInline(block.text);
    if (block.type === 'table') tables.push({ name: heading, rows: [block.header, ...block.rows].map(row => row.map(plainInline)) });
    if (block.type === 'chart') tables.push({ name: block.spec.title || heading, rows: [['', ...block.spec.series.map((s, i) => s.name || `Série ${i + 1}`)], ...block.spec.labels.map((label, i) => [label, ...block.spec.series.map(s => String(s.data[i]))])] });
  }
  // No table at all: one column with the text, line by line.
  if (!tables.length) tables.push({ name: '', rows: plainText(markdown).split('\n').map(line => [line]) });
  return tables;
}
export function toXlsx(markdown) {
  const used = new Set();
  const sheets = tablesOf(markdown).slice(0, 50).map((table, index) => {
    let name = (table.name || `Tabela ${index + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || `Tabela ${index + 1}`;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 27)} ${index + 1}`;
    used.add(name.toLowerCase());
    const column = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
    const rows = table.rows.slice(0, 5000).map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      const ref = column(c) + (r + 1); const style = r === 0 && table.rows.length > 1 ? ' s="1"' : ''; const parsed = r > 0 ? numeric(value) : null;
      return parsed !== null ? `<c r="${ref}"${style}><v>${parsed}</v></c>` : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const widths = (table.rows[0] || []).map((_, c) => Math.min(60, Math.max(8, ...table.rows.map(row => String(row[c] || '').length + 2))));
    return { name, xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${widths.length ? `<cols>${widths.map((width, c) => `<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>` : ''}<sheetData>${rows}</sheetData></worksheet>` };
  });
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F6"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>'],
    ...sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheet.xml])
  ]);
}

export function toCsv(markdown) {
  const quote = value => /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return '﻿' + tablesOf(markdown)[0].rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

/** Builds a file from Markdown. `pdf(html)` turns HTML into PDF bytes on the phone. */
const looksHtml = content => /^\s*(<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(content);
const safeHtml = content => content.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
/** A whole HTML page written by a bot, as Markdown-like text for the formats that cannot show HTML (Word, Excel, text). */
export function htmlToMarkdown(html) {
  return safeHtml(html).replace(/<(style|head|title)[\s\S]*?<\/\1>/gi, '').replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, level, text) => `\n\n${'#'.repeat(Number(level))} ${text}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/(p|div|tr|ul|ol|table|section|article)>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

/** Builds a file from Markdown (a whole HTML page is kept as it is for PDF and HTML). `pdf(html)` turns HTML into PDF bytes on the phone. */
export async function create({ name, format, content }, { pdf }) {
  const base = name.replace(/\.(pdf|docx|xlsx|csv|md|txt|html?)$/i, '');
  const file = `${base}.${format}`;
  const html = looksHtml(content);
  if (html && !['pdf', 'html', 'md'].includes(format)) content = htmlToMarkdown(content);
  let bytes;
  if (format === 'pdf') bytes = await pdf(html ? safeHtml(content) : toHtml(content, base));
  else if (format === 'docx') bytes = toDocx(content, base);
  else if (format === 'xlsx') bytes = toXlsx(content);
  else if (format === 'csv') bytes = Buffer.from(toCsv(content), 'utf8');
  else if (format === 'html') bytes = Buffer.from(html ? safeHtml(content) : toHtml(content, base), 'utf8');
  else if (format === 'txt') bytes = Buffer.from(splitMath(plainText(content)).map(piece => piece.math ? texText(piece.math) : piece.text).join('') + '\n', 'utf8');
  else bytes = Buffer.from(content.endsWith('\n') ? content : content + '\n', 'utf8');
  return { name: file, mime: FORMATS[format], bytes };
}
