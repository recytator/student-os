# Backlog i bezpieczna kontynuacja

Stan: **15.10.2026**, po wdrożeniu i produkcyjnym odbiorze rdzenia. Aplikacja: https://studentos.recytator.workers.dev. Dowody i granice testów: [TEST_REPORT.md](TEST_REPORT.md), [ACCEPTANCE.md](ACCEPTANCE.md). Kontynuację zaczynaj od [CONTINUATION.md](CONTINUATION.md); nie powtarzaj konfiguracji kont ani zakończonych testów bez potrzeby.

## Wykonane

- [x] Migracje D1 lokalnie i na Cloudflare, chronione CRUD i trwałość po świeżym odczycie API.
- [x] GitHub OAuth właściciela: użytkownik potwierdził logowanie i pulpit; autoryzacja, CSRF i izolacja mają testy.
- [x] PDF.js: rzeczywisty tekstowy PDF i komunikat wymagania OCR dla skanu w E2E.
- [x] Cztery rzeczywiste role GLM, checkpointy, retry, źródła i zatwierdzenie przez produkcyjne HTTPS.
- [x] Produkcyjny zapis 4 zadań, 4 terminów i 4 bloków nauki; sprawdzone eksporty ICS/JSON.
- [x] Testy dat, duplikatów, złego JSON, limitów, wyścigów etapów i idempotencji zatwierdzenia.
- [x] Pełne CI: 128 testów jednostkowych/integracyjnych oraz 12 E2E mobile/desktop.
- [x] Prawdziwe logi, pomiary względem referencji, dokumentacja i materiały prezentacyjne.

## Wykonane w v0.2 (19.10.2026)

- [x] Plan GI1/GL2 jako edytowalne zajęcia cykliczne z niepotwierdzonymi tygodniami i wyjątkami na pojedyncze dni; siatka tygodnia i widok dnia.
- [x] Notatki AI i fiszki z PDF, PPTX, DOCX i TXT; eksport Markdown i druk do PDF.
- [x] Rodzaje zadań, szybkie dodawanie z parsowaniem terminów, odliczanie do egzaminów, „Cofnij” po ukończeniu.
- [x] Nowy interfejs: Dziś, Plan, Zadania, Materiały, Przedmioty, paleta poleceń (Ctrl+K).
- [x] Wdrożenie nie uruchamia już testu AI na publicznym fixture ani jednorazowego skryptu naprawczego (oszczędza darmowy budżet Workers AI).

## P1 — dalszy odbiór i jakość codziennego użycia

- [ ] Potwierdzić rzeczywistą jakość notatek GLM na wykładach właściciela (różne języki, slajdy z małą ilością tekstu).
- [ ] Potwierdzić koniec semestru i tygodnie zajęć „do ustalenia” w planie (obecnie domyślnie 31.01.2027).

- [ ] Fizyczny Android: instalacja i aktualizacja PWA, klawiatura, ręczna korekta propozycji oraz pełny scenariusz PDF.
- [ ] Zachowanie danych po rzeczywistym wylogowaniu/ponownym logowaniu i synchronizacja z drugim urządzeniem.
- [ ] Rozszerzenie ekstrakcji AI o dokładne godziny wydarzeń i konflikty tych godzin. Obecne terminy AI mają dokładność dnia; ręczny kalendarz i plan zajęć obsługują godziny.
- [ ] Dalsze pomiary na rzeczywistych sylabusach. Historyczny zestaw konfliktowy miał recall obowiązków 0,75; najnowszy zestaw jednoznaczny 1. Nie utożsamiać tego z gwarancją jakości.
- [ ] Pomiar dokładnego CPU i neurons, jeśli metryki dostawcy są dostępne, oraz ocena dużych PDF. Przetestowany produkcyjny przepływ AI przeszedł na Free; nie jest to dowód dla każdego rozmiaru dokumentu.

## P2 — rozwój po stabilizacji

- OCR jako opcjonalny lokalny moduł z jawnymi limitami urządzenia.
- Wyjątki dostępności, dni wolne i bardziej szczegółowe planowanie.
- Import USOS/ICS i synchronizacja kalendarza po autoryzacji właściciela.
- Powiadomienia, powtórki i import maili z minimalnymi uprawnieniami.
- Wznowienie bez otwartego klienta wyłącznie przy dostępności gwarantowanego, bezpłatnego mechanizmu.

Nie resetuj rzeczywistego zużycia AI. Aktualne limity to 4 analizy i 24 wywołania dziennie, 12 wywołań na run i jeden retry. Zachowaj migracje, własność danych oraz potwierdzanie propozycji przez użytkownika.
