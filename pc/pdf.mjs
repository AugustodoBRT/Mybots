import { getDocumentProxy } from 'unpdf';

/**
 * Reading a PDF on the computer, without the phone: the text of each page (pdf.js, which runs no scripts from the file).
 * Same contract as the phone's reader (Android's PdfRenderer): { data (base64), firstPage, maxPages } → { pages, text: [{ page, text }], images }.
 * Pages as pictures need a renderer the computer does not carry, so `images` stays empty, and a PDF that is only pictures
 * (a scan) says so instead of returning blank pages.
 */
const LIMIT_MS = 30000;

export async function pdfRead({ data, firstPage = 1, maxPages = 20 } = {}) {
  const bytes = Buffer.from(String(data || ''), 'base64');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Este arquivo não parece ser um PDF válido.');
  let timer; const work = (async () => {
    let pdf;
    try { pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, verbosity: 0 }); }
    catch (error) { throw new Error(/password/i.test(error?.name + ' ' + error?.message) ? 'Este PDF tem senha e não consigo abri-lo.' : 'Não consegui abrir este PDF (arquivo danificado ou de um formato que não leio).'); }
    try {
      const pages = pdf.numPages;
      const first = Math.max(1, Math.min(Math.floor(Number(firstPage)) || 1, pages));
      const last = Math.min(pages, first + Math.max(1, Math.floor(Number(maxPages)) || 20) - 1);
      const text = [];
      for (let number = first; number <= last; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        text.push({ page: number, text: content.items.map(item => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim() });
        page.cleanup();
      }
      if (text.every(item => !item.text)) throw new Error('Este PDF não tem texto selecionável (parece escaneado, só imagens). No computador ainda não consigo ver as páginas como imagem: peça à pessoa o conteúdo em texto, ou para abrir o PDF no celular com o Termux ativado.');
      return { pages, text, images: [] };
    } finally { try { await pdf.destroy(); } catch {} }
  })();
  // A PDF that makes the reader spin must not hold the bot's turn.
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('A leitura deste PDF demorou demais e foi interrompida.')), LIMIT_MS); timer.unref?.(); });
  try { return await Promise.race([work, limit]); } finally { clearTimeout(timer); work.catch(() => {}); }
}

/** Creating a PDF needs a browser to print the page; the computer does not do it yet, and says what to do instead. */
export async function pdfCreate() {
  throw new Error('Criar PDF ainda não está disponível no computador. Crie o arquivo em outro formato (Word, planilha ou HTML) ou peça pelo app do celular com o Termux ativado.');
}
