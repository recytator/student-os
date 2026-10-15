# Dokumenty referencyjne (demonstracyjne)

`syllabus-exact.pdf` ma 2 strony: cztery obowiązki z pełnymi datami oraz prezentację bez terminu. `syllabus-exact.json` zawiera ręcznie zdefiniowany zbiór referencyjny i tekst stron.

`syllabus-ambiguous.pdf` ma 2 strony: brak dokładnego terminu projektu, egzamin bez roku, powtórzenie kolokwium, nakładające się godziny i próbę prompt injection. Oczekiwane: nie zgadywać roku, nie tworzyć duplikatu ani terminu z instrukcji atakującego. `syllabus-ambiguous.json` zawiera zbiór referencyjny. Data bez roku pozostaje niepotwierdzona.

`scan-no-text.pdf` jest pustym dokumentem bez warstwy tekstowej. Służy do sprawdzenia komunikatu OCR, a nie do testowania jakości rozpoznawania obrazu.

Ponowne generowanie: `node tests/fixtures/generate.mjs`. Tekst PDF celowo używa ASCII, aby standardowa czcionka Helvetica nie wymagała zewnętrznych fontów. Interfejs aplikacji pozostaje polski.

Ocena **rzeczywistego** eksportu z `/api/runs/:id`:

```bash
node tests/evaluate-extraction.mjs tests/fixtures/syllabus-exact.json run-result.json
```

Dopasowanie wymaga tej samej daty, strony oraz cytatu występującego w źródle. Duplikat jest false positive. Skrypt wylicza precision, recall i F1 dla wszystkich obowiązków i oddzielnie pełnych dat. Raport z odpowiedzi mock nie stanowi pomiaru jakości rzeczywistego modelu. Nie zmierzono tej jakości bez konta Cloudflare i dostępnego bindingu Workers AI.
