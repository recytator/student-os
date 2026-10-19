/** On-device text extraction. Only text and page/slide numbers ever leave the device. */
export type ParsedPage = { page: number; text: string };
export type Extracted = { pages: ParsedPage[]; hash: string; unit: 'strona' | 'slajd' | 'część' };

export const ACCEPT = '.pdf,.pptx,.docx,.txt,.md,application/pdf';
const MAX_PAGES = 100;
const MAX_PAGE_CHARS = 30_000;
const MAX_TOTAL_CHARS = 120_000;
const PSEUDO_PAGE = 3_000;

export const fileKind = (name: string) => {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return (['pdf', 'pptx', 'docx', 'txt', 'md'] as const).find((kind) => kind === ext) ?? null;
};

async function sha256(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validate(pages: ParsedPage[], unit: Extracted['unit']): ParsedPage[] {
  const clean = pages
    .map((page) => ({
      page: page.page,
      text: page.text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    }))
    .filter((page) => page.text.length > 0);
  const total = clean.reduce((sum, page) => sum + page.text.length, 0);
  if (total < 40)
    throw new Error(
      unit === 'strona'
        ? 'Nie znaleziono tekstu. Ten PDF prawdopodobnie zawiera skany i wymaga OCR — StudentOS nie wykonuje OCR.'
        : 'Nie znaleziono tekstu w pliku.',
    );
  if (clean.length > MAX_PAGES)
    throw new Error(
      `Limit to ${MAX_PAGES} ${unit === 'slajd' ? 'slajdów z tekstem' : 'stron'}. Podziel materiał na mniejsze pliki.`,
    );
  const big = clean.find((page) => page.text.length > MAX_PAGE_CHARS);
  if (big)
    throw new Error(
      `${unit === 'slajd' ? 'Slajd' : 'Strona'} ${big.page} przekracza limit 30 000 znaków.`,
    );
  if (total > MAX_TOTAL_CHARS)
    throw new Error(
      `Tekst ma ${total.toLocaleString('pl-PL')} znaków — limit to 120 000. Podziel materiał na części.`,
    );
  return clean;
}

/** Splits flowing text into ~3000-character parts on paragraph boundaries. */
export function pseudoPages(text: string): ParsedPage[] {
  const paragraphs = text.split(/\n{2,}|\r\n\r\n/);
  const pages: ParsedPage[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > PSEUDO_PAGE) {
      pages.push({ page: pages.length + 1, text: current });
      current = '';
    }
    current += (current ? '\n\n' : '') + paragraph;
    while (current.length > PSEUDO_PAGE * 2) {
      pages.push({ page: pages.length + 1, text: current.slice(0, PSEUDO_PAGE) });
      current = current.slice(PSEUDO_PAGE);
    }
  }
  if (current.trim()) pages.push({ page: pages.length + 1, text: current });
  return pages;
}

// ---- Minimal ZIP reader (stored + deflate) for Office Open XML ----
export async function readZip(buffer: ArrayBuffer): Promise<Map<string, () => Promise<string>>> {
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65_557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('Plik nie jest poprawnym dokumentem Office (brak struktury ZIP).');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, () => Promise<string>>();
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Uszkodzony katalog ZIP.');
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    entries.set(name, async () => {
      const start =
        local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = new Uint8Array(buffer, start, compressed);
      if (method === 0) return decoder.decode(data);
      if (method !== 8) throw new Error('Nieobsługiwana kompresja w pliku.');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    });
  }
  return entries;
}

const decodeXml = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');

/** Text of DrawingML (a:) or WordprocessingML (w:) paragraphs, one paragraph per line. */
export function xmlParagraphs(xml: string, ns: 'a' | 'w'): string {
  const paragraphs = xml.split(new RegExp(`</${ns}:p>`));
  const tag = new RegExp(
    `<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>|<${ns}:(?:br|tab)\\b[^>]*/>`,
    'g',
  );
  return paragraphs
    .map((paragraph) => {
      let line = '';
      for (const match of paragraph.matchAll(tag))
        line +=
          match[1] !== undefined ? decodeXml(match[1]) : match[0].includes(':tab') ? '\t' : '\n';
      return line.trim();
    })
    .filter(Boolean)
    .join('\n');
}

const relTargets = (xml: string) => {
  const map = new Map<string, { target: string; type: string }>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attr = (name: string) => match[1]!.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
    map.set(attr('Id'), { target: attr('Target'), type: attr('Type') });
  }
  return map;
};

export async function extractPptx(buffer: ArrayBuffer): Promise<ParsedPage[]> {
  const zip = await readZip(buffer);
  const read = async (path: string) => (zip.has(path) ? zip.get(path)!() : '');
  let slidePaths: string[] = [];
  const presentation = await read('ppt/presentation.xml');
  const rels = relTargets(await read('ppt/_rels/presentation.xml.rels'));
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)) {
    const target = rels.get(match[1]!)?.target;
    if (target) slidePaths.push(`ppt/${target.replace(/^\/?ppt\//, '').replace(/^\.\.\//, '')}`);
  }
  if (!slidePaths.length)
    slidePaths = [...zip.keys()]
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  if (!slidePaths.length) throw new Error('Nie znaleziono slajdów w prezentacji.');
  const pages: ParsedPage[] = [];
  for (const [index, path] of slidePaths.entries()) {
    const slide = xmlParagraphs(await read(path), 'a');
    const slideRels = relTargets(
      await read(path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')),
    );
    const notesTarget = [...slideRels.values()].find((rel) =>
      rel.type.endsWith('/notesSlide'),
    )?.target;
    const notes = notesTarget
      ? xmlParagraphs(await read(`ppt/${notesTarget.replace(/^\.\.\//, '')}`), 'a')
          .split('\n')
          .filter((line) => !/^\d+$/.test(line.trim()))
          .join('\n')
      : '';
    pages.push({
      page: index + 1,
      text: notes ? `${slide}\n\nNotatki prowadzącego:\n${notes}` : slide,
    });
  }
  return pages;
}

export async function extractDocx(buffer: ArrayBuffer): Promise<ParsedPage[]> {
  const zip = await readZip(buffer);
  const document = zip.get('word/document.xml');
  if (!document) throw new Error('Nie znaleziono treści dokumentu Word.');
  return pseudoPages(xmlParagraphs(await document(), 'w').replace(/\n/g, '\n\n'));
}

export async function extractFile(
  file: File,
  onProgress: (message: string) => void,
): Promise<Extracted> {
  const kind = fileKind(file.name);
  if (!kind) throw new Error('Obsługiwane formaty: PDF, PPTX, DOCX, TXT i MD.');
  const limit = kind === 'pdf' ? 60 : kind === 'txt' || kind === 'md' ? 5 : 120;
  if (file.size > limit * 1024 * 1024) throw new Error(`Plik przekracza limit ${limit} MB.`);
  const buffer = await file.arrayBuffer();
  const hash = await sha256(buffer);
  if (kind === 'pdf') {
    const { parsePdf } = await import('./pdf');
    const pages = await parsePdf(buffer, (current, total) =>
      onProgress(`Odczytuję stronę ${current} z ${total}`),
    );
    return { pages: validate(pages, 'strona'), hash, unit: 'strona' };
  }
  onProgress('Odczytuję tekst…');
  if (kind === 'pptx')
    return { pages: validate(await extractPptx(buffer), 'slajd'), hash, unit: 'slajd' };
  if (kind === 'docx')
    return { pages: validate(await extractDocx(buffer), 'część'), hash, unit: 'część' };
  return {
    pages: validate(pseudoPages(new TextDecoder().decode(buffer)), 'część'),
    hash,
    unit: 'część',
  };
}
