# Decyzje techniczne

Data rozpoczęcia: 15.10.2026. Decyzje opisują stan projektu i ograniczenia, bez sugerowania zakończonego wdrożenia.

## ADR-001: Jeden Worker i D1

Wybór: React/Vite jako Static Assets, API TypeScript w tym samym Workerze, Cloudflare D1 jako baza. Cel: mała liczba usług, wspólna domena, brak własnego serwera i płatnego API LLM. Konsekwencja: projekt respektuje limity Workers Free i wymaga wdrożenia na koncie właściciela. Przeniesienie wymaga adaptera HTTP, SQL i dostawcy inferencji; kontrakty agentów pozostają niezależne.

## ADR-002: Jawna maszyna stanów zamiast frameworka agentowego

Stan `document → deadline → planner → review → approval → committed` i checkpointy D1. Etap to osobne żądanie, a nie niegwarantowane zadanie w tle. Konsekwencja: klient inicjuje kolejne etapy, a po zamknięciu aplikacji analiza czeka na wznowienie. Lease i ograniczone ponowienia zapobiegają równoczesnym wywołaniom i pętlom korekt.

## ADR-003: PDF.js na urządzeniu

Oryginał nie jest wysyłany do LLM ani przechowywany w chmurze. Zapisujemy tekst stron, metadane i hash. Konsekwencja: oszczędność storage i transferu oraz mniejszy zakres danych; oryginał nie jest dostępny po zmianie urządzenia. Brak OCR zgłaszamy jako ograniczenie, zamiast wytwarzać wynik dla skanu.

## ADR-004: Kontrakty Zod i deterministyczna walidacja

Każdy agent ma osobny input/output schema w `shared/contracts.ts`. Zod kontroluje strukturę, a kod sprawdza zgodność cytatów, daty, konflikty i duplikaty. LLM nie zapisuje bezpośrednio do tabel akademickich. Brak jednoznacznej daty daje `due_date: null` i wymaga potwierdzenia; szacunki nauki są oznaczone `estimated: true`.

## ADR-005: GitHub OAuth i prywatne sesje

Wybrano OAuth bez dodatkowej subskrypcji zamiast uzależniać projekt od aktywacji Cloudflare Zero Trust. Sekrety pozostają w sekretach Workera/GitHub Actions, sesja jest losowa i HttpOnly, w bazie zapisujemy jej hash. Konsekwencja: właściciel musi utworzyć OAuth App z dokładnym callbackiem docelowej domeny. Produkcyjny dostęp osobisty ogranicza serwerowy identyfikator GitHub właściciela. `localStorage` nie jest mechanizmem logowania.

## ADR-006: Walidowany JSON tylko na granicy zmiennych wyników

Przedmioty, zadania, plan i relacje są znormalizowane. Checkpointy, odpowiedzi agentów i preferencje przechowujemy jako walidowany JSON. Pozwala to zachować stabilne CRUD-y i rozwijać kontrakty agentów. Migracje dotyczą schematu, zmiana promptów/kontraktów wymaga unieważnienia odpowiedniego klucza cache.

## ADR-007: Bezpłatny dostawca z limitami aplikacji

Używamy bindingu Workers AI. Domyślny identyfikator modelu jest konfigurowalny przez `AI_MODEL`; wywołania OpenAI i Anthropic nie są potrzebne. Konsekwencja: brak skonfigurowanego bindingu, brak uprawnień do modelu lub wyczerpanie puli to jawny błąd analizy, a nie zastąpienie wyniku animacją. Nie włączamy automatycznie rozliczeń za nadwyżki. Limity i metryki dostawcy wymagają sprawdzenia na koncie docelowym.

## ADR-008: Akceptacja użytkownika jest granicą zapisu

Niepewne propozycje pozostają w `analysis_results`. Użytkownik edytuje i zatwierdza wybrane zadania/bloki, a orkiestrator zapisuje je w transakcyjnym batchu. Idempotencja opiera się o identyfikator propozycji i dokumentu. Powtórne zatwierdzenie nie może tworzyć drugiego kompletu zadań.

## ADR-009: Rozdzielenie agentów produktu od agentów developerskich

DocumentAgent, DeadlineAgent, PlannerAgent i ReviewAgent są rolami uruchamianymi przez aplikację. Architect, Frontend, Backend, AI i QA są rzeczywistymi zadaniami pomocniczymi sesji Codex, koordynowanymi przez Supervisor. Historii developmentu nie wykorzystujemy jako historii wykonania produktu. Konkretne delegacje opisuje `DEVELOPMENT_LOG.md`.

## ADR-010: Atomowa blokada aktywnych analiz

Samo sprawdzenie istnienia uruchomienia przed `INSERT` nie zabezpiecza przed wyścigiem dwóch żądań. Migracja `0002_one_active_run.sql` dodaje częściowy indeks UNIQUE na `(user_id,document_id)` dla stanów `document`, `deadline`, `planner`, `review`, `approval`. Orkiestrator po konflikcie zwraca istniejące wykonanie. Dzienna rezerwacja analizy może w wyścigu zostać zużyta konserwatywnie; nigdy nie zwiększa to liczby dozwolonych wywołań AI. Przed utworzeniem indeksu migracja zamyka historyczne duplikaty, zachowując najbardziej zaawansowany workflow oraz wszystkie checkpointy i logi. Nie zmieniamy już zastosowanej migracji `0001`.

## ADR-011: Zgodna semantycznie składnia triggerów dla zdalnej migracji

Pierwsza próba wdrożenia zgłosiła `incomplete input: SQLITE_ERROR 7500` dla migracji `0001`, chociaż SQLite, Miniflare i lokalny splitter Wrangler przechodziły. Analiza kodu Wrangler 4.151 wykazała różne ścieżki: lokalnie używa `unstable_splitSqlQuery`, a zdalne `migrations apply` przekazuje cały plik i znacznik migracji jako jedno pole `sql` do REST `/query`. Nie mamy dowodu, że błąd pochodzi z lokalnego splittera.

Przygotowano minimalną poprawkę zgodności: w triggerach `0001` i `0003` wyrażenia `SELECT CASE WHEN warunek THEN RAISE(ABORT,...) END` zastępuje równoważne `SELECT RAISE(ABORT,...) WHERE warunek`. Usunięto średniki z komentarzy SQL. Warunki kontroli właściciela, rodzaj przerwania i komunikaty pozostają takie same. Regresja `tests/integration/migration-transport.test.ts` wykonuje faktyczny splitter zainstalowanego Wrangler, wszystkie migracje i 20 prób przekroczenia własności w D1 Miniflare. Wynik lokalny nie potwierdza jeszcze usunięcia błędu zdalnego; musi go potwierdzić ponowny run CI.

Jest to wyjątek od utrzymywania zastosowanych migracji jako niezmiennych: lokalnie zastosowana składnia ma identyczne działanie, a pierwsza zdalna migracja nie została zatwierdzona. Nie wprowadzamy własnego protokołu migracji ani dodatkowej usługi.

## Źródła discovery — zweryfikowane 15.10.2026

Supervisor sprawdził aktualną oficjalną dokumentację przed implementacją. Wartości są limitami oferty, nie odczytem zużycia konta użytkownika.

| Usługa Free | Udokumentowany limit                                                          | Konsekwencja                                                          |
| ----------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Workers AI  | 10 000 neuronów dziennie; odcięcie po wyczerpaniu Free                        | Jawny błąd analizy; CRUD nadal działa                                 |
| D1          | 5 mln odczytywanych i 100 tys. zapisywanych wierszy dziennie, 5 GB łącznie    | Indeksy, limity kolekcji i retencja danych                            |
| Workers     | 100 tys. żądań dziennie, 10 ms CPU, 128 MB pamięci, 3 MB skompresowanego kodu | PDF na kliencie, etapy w osobnych żądaniach, kontrola rozmiaru bundla |

- [Workers AI — pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [D1 — pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Workers — limits](https://developers.cloudflare.com/workers/platform/limits/)
- [GLM-4.7-Flash — karta modelu](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
- [Gemma-4-26B-A4B-IT — karta modelu](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)

Identyfikator preferowany: `@cf/zai-org/glm-4.7-flash`; alternatywny: `@cf/google/gemma-4-26b-a4b-it`. W sprawdzonej dokumentacji modele te nie znajdowały się na liście wymagającej płatnego planu. GLM obsługuje binding `env.AI.run` i wiadomości; preferowany parametr limitu generacji to `max_completion_tokens` (starszy `max_tokens` jest oznaczony jako przestarzały). Brak własnego wywołania na koncie docelowym pozostaje ograniczeniem weryfikacji, niezależnie od dostępności dokumentacji.

Aktualna linia `@cloudflare/workers-types` to major 5; sprawdzona wersja rejestru `5.20261015.1`. Żądanie hipotetycznej wersji `4.20261001.0` nie działało. Supervisor poprawił zależność podczas foundation. Zainstalowaną wersję należy odczytywać z lockfile, a nie z tej notatki historycznej.
