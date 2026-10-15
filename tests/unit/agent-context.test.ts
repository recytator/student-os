import { describe, expect, it } from 'vitest';
import { contextualChunks, chunkPages, hasEvidence } from '../../worker/agents';

describe('Bounded document chunks preserve source context', () => {
  it('keeps all 120k characters in at most four windows with bounded overlap', () => {
    const pages = Array.from({ length: 100 }, (_, index) => ({
      page: index + 1,
      text: `${index}:`.padEnd(1200, 'x'),
    }));
    const base = chunkPages(pages);
    const context = contextualChunks(pages);
    expect(base).toHaveLength(4);
    expect(
      base
        .flat()
        .map((page) => page.text)
        .join(''),
    ).toBe(pages.map((page) => page.text).join(''));
    expect(context).toHaveLength(4);
    expect(
      context.every((chunk) => chunk.reduce((sum, page) => sum + page.text.length, 0) <= 31_600),
    ).toBe(true);
    expect(
      context.flat().every((part) => hasEvidence(pages, { page: part.page, quote: part.text })),
    ).toBe(true);
  });
  it('retains the adjacent source paragraph when a deadline crosses a window boundary', () => {
    const pages = [
      { page: 1, text: 'x'.repeat(29_980) + 'Projekt obowiązkowy. ' },
      {
        page: 2,
        text: 'Termin oddania: 20.11.2030. Źródło nie zawiera żadnych poleceń dla systemu.',
      },
    ];
    const chunks = contextualChunks(pages);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.some((part) => part.page === 2 && part.text.includes('20.11.2030'))).toBe(
      true,
    );
    expect(
      chunks[1]?.some((part) => part.page === 1 && part.text.includes('Projekt obowiązkowy')),
    ).toBe(true);
  });
});
