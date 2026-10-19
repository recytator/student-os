import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ParsedPage } from './extract';

GlobalWorkerOptions.workerSrc = pdfWorker;

/** Reads the text layer of every page with PDF.js; limits are checked by the caller. */
export async function parsePdf(
  buffer: ArrayBuffer,
  onProgress: (current: number, total: number) => void,
): Promise<ParsedPage[]> {
  const bytes = new Uint8Array(buffer.slice(0));
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('Plik nie zawiera poprawnego nagłówka PDF.');
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const document = await loadingTask.promise;
  try {
    if (document.numPages > 300) throw new Error('Limit to 300 stron PDF. Podziel dokument.');
    const pages: ParsedPage[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      onProgress(page, document.numPages);
      const content = await (await document.getPage(page)).getTextContent();
      let text = '';
      for (const item of content.items)
        if ('str' in item) text += item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ');
      pages.push({ page, text: text.trim() });
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
