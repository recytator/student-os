import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { extractDocx, extractPptx, pseudoPages, validate, xmlParagraphs } from '../../src/extract';
import { parseQuickTask } from '../../src/lib/quickadd';
import { layoutColumns, type Occurrence } from '../../src/lib/schedule';
import { warsawInstant } from '../../src/lib/time';

const fixture = async (name: string) => {
  const bytes = await readFile(new URL(`../fixtures/${name}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

describe('ekstrakcja tekstu na urządzeniu', () => {
  it('czyta slajdy PPTX w kolejności prezentacji razem z notatkami prowadzącego', async () => {
    const pages = await extractPptx(await fixture('lecture.pptx'));
    expect(pages.map((page) => page.page)).toEqual([1, 2]);
    expect(pages[0]!.text).toBe(
      'Percepcja wizyjna — wykład 1\nKamera otworkowa i macierz K\nKalibracja & zniekształcenia\n\nNotatki prowadzącego:\nPamiętać o przykładzie z OpenCV.',
    );
    expect(pages[1]!.text).toContain('Mapa głębi: Z = f·B / d');
  });

  it('czyta akapity DOCX i dekoduje encje XML', async () => {
    const pages = await extractDocx(await fixture('notes.docx'));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.text).toContain('Kolokwium odbędzie się 02.12.2026 <w sali A204>.');
  });

  it('dzieli długi tekst na części i pilnuje limitów', () => {
    const parts = pseudoPages(
      Array.from({ length: 30 }, (_, i) => `Akapit ${i} `.repeat(30)).join('\n\n'),
    );
    expect(parts.length).toBe(4);
    expect(parts.every((part) => part.text.length <= 6000)).toBe(true);
    expect(() => validate([{ page: 1, text: 'za mało' }], 'strona')).toThrow('OCR');
    expect(() => validate([{ page: 1, text: 'x'.repeat(30_001) }], 'slajd')).toThrow('Slajd 1');
    expect(
      xmlParagraphs('<a:p><a:r><a:t>A</a:t></a:r><a:br/><a:r><a:t>B</a:t></a:r></a:p>', 'a'),
    ).toBe('A\nB');
  });
});

describe('szybkie dodawanie i plan', () => {
  const subjects = [
    { id: 'uav', name: 'Przetwarzanie danych sensorycznych UAV' },
    { id: 'vision', name: 'Percepcja wizyjna w robotyce' },
  ] as never[];
  it('rozpoznaje termin, przedmiot, rodzaj i priorytet', () => {
    // 19.10.2026 is a Monday.
    expect(parseQuickTask('Kolokwium z wizji w pt #percepcja !', subjects, '2026-10-19')).toEqual({
      title: 'Kolokwium z wizji',
      due_date: '2026-10-23',
      kind: 'colloquium',
      priority: 'high',
      subject_id: 'vision',
    });
    expect(parseQuickTask('Projekt UAV 12.11', subjects, '2026-10-19')).toMatchObject({
      title: 'Projekt UAV',
      due_date: '2026-11-12',
      kind: 'project',
    });
    expect(parseQuickTask('Egzamin jutro #uav', subjects, '2026-10-19')).toMatchObject({
      due_date: '2026-10-20',
      kind: 'exam',
      subject_id: 'uav',
    });
    expect(parseQuickTask('Przeczytać rozdział za 3 dni', subjects, '2026-10-19').due_date).toBe(
      '2026-10-22',
    );
    expect(parseQuickTask('Oddać 05.09', subjects, '2026-10-19').due_date).toBe('2027-09-05');
    expect(parseQuickTask('pt', subjects, '2026-10-19')).toMatchObject({
      title: 'pt',
      due_date: null,
    });
  });

  it('układa nachodzące zajęcia obok siebie i zna offset strefy czasowej', () => {
    const item = (id: string, start: number, end: number) => ({ id, start, end }) as Occurrence;
    const placed = layoutColumns([item('a', 600, 700), item('b', 600, 700), item('c', 720, 800)]);
    expect(placed.map((p) => [p.item.id, p.column, p.columns])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 1],
    ]);
    expect(warsawInstant('2026-10-19', '10:00')).toBe('2026-10-19T10:00:00+02:00');
    expect(warsawInstant('2026-11-02', '10:00')).toBe('2026-11-02T10:00:00+01:00');
    expect(warsawInstant('2026-10-25', '02:30')).toMatch(/^2026-10-25T02:30:00\+0[12]:00$/);
  });
});
