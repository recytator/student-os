import { readFile } from 'node:fs/promises';

const [goldPath, resultPath] = process.argv.slice(2);
if (!goldPath || !resultPath) {
  process.stderr.write(
    'Uzycie: node tests/evaluate-extraction.mjs tests/fixtures/syllabus-exact.json rzeczywisty-wynik.json\nWynik: {proposals:[...]} lub odpowiedz API {result:{proposals:[...]}}.\n',
  );
  process.exitCode = 1;
} else {
  const reference = JSON.parse(await readFile(goldPath, 'utf8'));
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  const proposals = result.proposals ?? result.result?.proposals;
  if (!Array.isArray(proposals)) throw new Error('Brak tablicy proposals w pliku wynikowym.');
  const normalize = (value) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const sourceMatches = (prediction, expected) =>
    prediction.sources?.some(
      (source) =>
        source.page === expected.page &&
        (normalize(source.quote).includes(normalize(expected.quote)) ||
          normalize(expected.quote).includes(normalize(source.quote))) &&
        normalize(source.quote).length >= 12,
    );
  function measure(expected, predicted) {
    const available = new Set(expected.map((_, index) => index));
    let tp = 0;
    for (const prediction of predicted) {
      const index = [...available].find(
        (candidate) =>
          (prediction.due_date ?? null) === expected[candidate].due_date &&
          sourceMatches(prediction, expected[candidate]),
      );
      if (index !== undefined) {
        available.delete(index);
        tp++;
      }
    }
    const fp = predicted.length - tp;
    const fn = expected.length - tp;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    return {
      true_positive: tp,
      false_positive: fp,
      false_negative: fn,
      precision,
      recall,
      f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    };
  }
  process.stdout.write(
    JSON.stringify(
      {
        reference: goldPath,
        result: resultPath,
        note: 'Metryki odnosza sie tylko do dostarczonego pliku wynikowego. Nie potwierdzaja samodzielnie rzeczywistego wywolania AI. TP wymaga daty oraz zgodnej strony i cytatu.',
        obligations: measure(reference.gold, proposals),
        explicit_dates: measure(
          reference.gold.filter((item) => item.due_date),
          proposals.filter((item) => item.due_date),
        ),
      },
      null,
      2,
    ) + '\n',
  );
}
