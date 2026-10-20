import { describe, expect, it } from 'vitest';
import { parseModelJson } from '../../worker/notes';

describe('parseModelJson', () => {
  it('czyta poprawny JSON, także w bloku kodu', () => {
    expect(parseModelJson('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
  });

  it('odzyskuje kompletne elementy uciętej odpowiedzi', () => {
    expect(parseModelJson('{"title":"T","sections":[{"h":"A","p":["x"]},{"h":"B","p":["y')).toEqual(
      {
        title: 'T',
        sections: [
          { h: 'A', p: ['x'] },
          { h: 'B', p: [] },
        ],
      },
    );
    expect(parseModelJson('{"title":"a, \\"b\\", c","sections":[')).toEqual({
      title: 'a, "b", c',
      sections: [],
    });
  });

  it('odrzuca odpowiedź bez JSON', () => {
    expect(() => parseModelJson('Przepraszam, nie mogę.')).toThrow(SyntaxError);
  });
});
