# Raport testów StudentOS

Raport aktualizowany przez rzeczywiście uruchomionego QA Agenta. Data: 15.10.2026. Wyników lokalnych nie należy utożsamiać z wdrożeniem produkcyjnym ani dostępem do Cloudflare Workers AI.

## Metody i granice dowodów

- Vitest: walidacja kontraktów, kalendarza, źródeł, reguł przeglądu, autoryzacji i budżetów.
- Integracja: prawdziwy lokalny emulator D1 (Miniflare/workerd), pełne migracje SQL, rzeczywisty handler aplikacji Worker. Jedynie binding AI ma jawne odpowiedzi testowe. D1 nie jest mockiem.
- Playwright: wykonane projekty Android Chromium 390 × 844 oraz desktop Chromium 1440 × 1000. Rzeczywisty frontend, parser PDF.js, API i lokalny D1; emulacja viewportu i dotyku, bez fizycznego telefonu.
- Żaden test nie wywołuje zdalnego modelu AI i nie generuje opłat. Przygotowany kod produkcyjny korzysta z bindingu Workers AI; działanie tego bindingu wymaga osobnej walidacji po autoryzacji konta.

## Stan weryfikacji

Ostatni pełny przebieg QA: 15.10.2026, 12:44 UTC.

| Weryfikacja                         | Rzeczywisty wynik                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `npm test`                          | **56/56 PASS**, 10 plików, 20,13 s                                              |
| `npm run lint`                      | **PASS**, brak błędów ESLint                                                    |
| `npm run build`                     | **PASS**, TypeScript strict i kompilacja Vite                                   |
| `npm run test:e2e`                  | **12/12 PASS**, 29,1 s, po 6 na mobile i desktop                                |
| PDF.js 6                            | **PASS**, faktyczne odczytanie dwóch stron i dat 20.11.2026 / 22.01.2027        |
| PWA                                 | **PASS**, manifest, ikony, rejestracja SW, brak `/api/` w cache                 |
| Układ                               | **PASS**, brak poziomego przewijania na wszystkich 7 ekranach w obu viewportach |
| Rzeczywisty Workers AI / zdalny D1  | **NIE WYKONANO** — brak autoryzacji usług                                       |
| Fizyczny Android / logowanie GitHub | **NIE WYKONANO** — wymaga wdrożenia i konfiguracji OAuth                        |

Dodatkowo cały GitHub Actions CI zakończył się **success** dla commitu `7c96aa1fd3d0c343b3e396ab41afef89ada8c5e0`: [zweryfikowany przebieg 38737400553](https://github.com/recytator/student-os/actions/runs/38737400553). Na runnerze GitHub przeszły `npm ci`, lint, formatowanie, testy, build, Wrangler dry-run oraz E2E z przeglądarką zainstalowaną przez Playwright. To nadal CI, nie wdrożenie Cloudflare.

Późniejszy przebieg CI dla commitu `ac018dd` nie przeszedł: [38737776503](https://github.com/recytator/student-os/actions/runs/38737776503), job `116431362155`. Test rozdzielenia budżetów odczytu i zapisu przekroczył domyślne 5000 ms podczas sekwencji 65 GET, 60 POST, dodatkowego POST ponad limit i końcowego GET. Nie zgłoszono nieudanej asercji. Dla tego jednego testu zwiększono limit do 30 000 ms, zachowując wszystkie żądania i sprawdzenia. Lokalna weryfikacja poprawki: `npm test -- tests/integration/api-consistency.test.ts` — **9/9 PASS**, 5,15 s (15.10.2026, 14:45 UTC); ESLint tego pliku — **PASS**. Ponowne potwierdzenie GitHub CI dla tej poprawki pozostaje do wykonania; wcześniejszy sukces CI powyżej dotyczy podanego wcześniejszego commitu.

Playwright korzystał z produkcyjnego buildu serwowanego przez lokalny Worker na porcie 8899. Oddzielny D1 w `.wrangler/e2e/` jest tworzony od nowa przy starcie testów. Nie resetuje standardowej bazy deweloperskiej. Wszystkie trzy migracje SQL zostały zastosowane.

Sprawdzono wizualnie rzeczywiste zrzuty ukończonych zadań na mobile i dokumentów na desktopie. Zrzuty QA powstają w `test-results/{android,desktop}-chromium-{tasks,documents}.png`. Root dodatkowo niezależnie przejrzał 21 widoków przy 320/390/1440 px; szczegóły w dokumentacji procesu.

`npm test` zapisuje rzeczywiste metadane demonstracyjnego przebiegu orkiestratora do `artifacts/qa-workflow-mock.json`. Nagłówek pliku jednoznacznie oznacza mock AI. Czasy i checkpointy pochodzą z faktycznego lokalnego wykonania; odpowiedzi i liczniki tokenów są kontrolowanymi danymi testowymi.

## Zakres testów integracyjnych

1. Izolacja rekordów użytkowników zarówno w API, jak i triggerach D1.
2. Wycofanie całego batch D1 po naruszeniu ograniczenia integralności.
3. CSRF, odmowa anonimowego dostępu, brak zdalnego obejścia przez DEV_AUTH.
4. Import dokumentu, serwerowe przeliczanie skrótu i deduplikacja treści mimo zmienionej nazwy/pliku hash dostarczonego przez klienta.
5. Cztery odrębne etapy agentów, checkpoint po każdym żądaniu i wznowienie przez ponowny odczyt D1.
6. Prawdziwe operacyjne logi etapów: czas, stan, schemat wyniku, przekazane tokeny z demonstracyjnego bindingu AI. Dane nie opisują rzeczywistego zużycia Cloudflare.
7. Brak zadań przed zatwierdzeniem, atomowe zatwierdzenie i idempotencja ponownego kliknięcia.
8. Nieprawidłowy JSON, fałszywy cytat i niepełny rok: odrzucenie lub wymagane potwierdzenie.
9. Jeden retry, limity dzienne, limit dostawcy i dalsza dostępność ręcznych funkcji po błędzie AI.
10. Blokada współbieżnego kroku orkiestratora; duże zatwierdzenie bez przekroczenia limitu parametrów SQL.
11. Kaskadowe usuwanie dokumentów, powiązanych wyników i zatwierdzonych pochodnych.

## Dokumenty i jakość ekstrakcji

Referencje znajdują się w `tests/fixtures/`. Dwa PDF-y po dwie strony zawierają pełne daty oraz przypadki niepełne, powtórzenia, konflikty i prompt injection. Pliki JSON zawierają ręcznie przygotowany zbiór referencyjny. Osobny PDF bez tekstu weryfikuje jednoznaczny komunikat OCR.

Nie zmierzono trafności rzeczywistego LLM: dostęp do Cloudflare Workers AI nie został jeszcze potwierdzony. Testy z odpowiedziami demonstracyjnymi potwierdzają logikę przepływu, nie zdolność modelu do ekstrakcji.

Po rzeczywistej analizie należy pobrać JSON z `/api/runs/:id` i wykonać:

```bash
node tests/evaluate-extraction.mjs tests/fixtures/syllabus-exact.json run-result.json
node tests/evaluate-extraction.mjs tests/fixtures/syllabus-ambiguous.json ambiguous-run-result.json
```

Skrypt raportuje precision, recall i F1. Poprawne dopasowanie wymaga daty oraz strony i cytatu. Duplikaty zwiększają false positives. Brakujące daty nie mogą zostać zastąpione zgadywanym rokiem.

## Powtarzalne uruchomienie

```bash
npm ci
node tests/fixtures/generate.mjs
npm test
npm run lint
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Konfiguracja Playwright sama kompiluje aplikację, odtwarza wydzielony testowy D1, stosuje lokalne migracje i uruchamia Worker z produkcyjnymi statycznymi zasobami oraz DEV_AUTH wyłącznie na localhost (port 8899). Nie wymaga produkcyjnego sekretu. Jeśli środowisko ma `/usr/bin/chromium`, korzysta z tej przeglądarki. Na tym środowisku pobranie Playwright Chromium z cdn.playwright.dev zostało odrzucone przez politykę sieci (403 Domain forbidden); dostępna jest systemowa przeglądarka Chromium.

## Błędy wykryte podczas pracy

- Niezgodność `users.avatar_url` z autoryzacją przy wartości null: poprawiona przez Backend Agenta przed testami runtime.
- Nieprawidłowe daty i offset +25:00 przechodzące część walidacji bibliotecznej: dodano niezależną kontrolę kalendarza i `Date.parse`.
- Data dopasowana jako podciąg dłuższej liczby i stały letni offset: poprawione w walidatorze agentów.
- Obejście autoryzacji deweloperskiej poza localhost: testy potwierdzają odmowę dostępu.
- Wylogowanie przez GET i błędne pole stanu logu: poprawione przez Frontend Agenta.
- Nieobsługiwany compatibility_date względem binarnego workerd: przyjęto obsługiwaną datę 06.08.2026.
- Zmiana API PDF.js 6 (`isEvalSupported`) i błędy parsera CSS: poprawione; build i testy rzeczywistego parsera PDF przechodzą.
- Niepowiązany import PDF z uruchomieniem workflow: poprawiony — import tworzy checkpoint, nie wywołuje automatycznie modelu.
- Brak nazwy dostępności mobilnego szybkiego dodawania: dodano `aria-label`; test utworzenia zadania przechodzi na mobile.
- CSRF odrzucający legalny lokalny proxy Vite: dodano ograniczoną obsługę lokalnego środowiska deweloperskiego; reguły produkcyjne pozostają rygorystyczne.
- Grupowy zapis dużej liczby propozycji przekraczał ograniczenia SQL: poprawiono sposób grupowania; testy 40 zadań oraz 100 bloków nauki przechodzą w rzeczywistym lokalnym D1.

## Pozostałe wymagane testy produkcyjne

Po konfiguracji Cloudflare i GitHub OAuth: logowanie z telefonu, rzeczywisty AI binding, cztery role z rzeczywistymi odpowiedziami, dokładne zużycie dostawcy jeśli udostępnione, trwałość danych po ponownym logowaniu, migracje zdalnego D1, instalacja PWA na Androidzie i test synchronizacji między urządzeniami. Tych wyników nie można potwierdzić na podstawie testów lokalnych.

Po poprawce limitu czasu pełny [CI dla b7683f5](https://github.com/recytator/student-os/actions/runs/38754614213) zakończył się `completed / success`, łącznie z testami oraz E2E. Kontrola [gotowości wdrożenia](https://github.com/recytator/student-os/actions/runs/38754614301) działa poprawnie, ale jej raport ma status `blocked`: oba sekrety Cloudflare i oba sekrety OAuth są nieobecne w GitHub Actions. Właściciel jest poprawnie określony automatycznie. To wynik sprawdzenia konfiguracji, nie wdrożenie.
