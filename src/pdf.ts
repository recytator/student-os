import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorker;
export type ParsedPage = { page: number; text: string };

export async function parsePdf(
  file: File,
  onProgress: (current: number, total: number) => void,
): Promise<{ pages: ParsedPage[]; hash: string }> {
  if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf'))
    throw new Error('Wybierz dokument w formacie PDF.');
  if (file.size > 10 * 1024 * 1024)
    throw new Error('Dokument przekracza limit 10 MB. Podziel go na mniejsze pliki.');
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('Plik nie zawiera poprawnego nagłówka PDF.');
  const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  const hash = Array.from(hashBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const pdfOptions = { data: bytes, useSystemFonts: true };
  const loadingTask = getDocument(pdfOptions);
  const document = await loadingTask.promise;
  try {
    if (document.numPages > 100)
      throw new Error('Limit to 100 stron. Podziel dokument na mniejsze części.');
    const pages: ParsedPage[] = [];
    let characters = 0;
    for (let page = 1; page <= document.numPages; page++) {
      onProgress(page, document.numPages);
      const content = await (await document.getPage(page)).getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ');
      }
      text = text.trim();
      if (text.length > 30_000)
        throw new Error(`Strona ${page} przekracza limit 30 000 znaków. Podziel dokument.`);
      characters += text.length;
      if (characters > 120_000)
        throw new Error('Tekst przekracza limit 120 000 znaków. Podziel dokument.');
      pages.push({ page, text });
    }
    if (characters < 40)
      throw new Error(
        'Nie znaleziono tekstu. Ten PDF prawdopodobnie zawiera skany i wymaga OCR. StudentOS nie wykonuje OCR.',
      );
    return { pages, hash };
  } finally {
    await loadingTask.destroy();
  }
}
