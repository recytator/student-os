# Raport testów StudentOS

Stan: **15.10.2026**. Rozdzielamy testy lokalne, testy handlera ze zdalnymi bindingami, produkcyjne HTTP i odbiór użytkownika. Dowód z jednej warstwy nie zastępuje pozostałych.

## Aktualny stan weryfikacji

| Zakres                                    | Potwierdzony wynik                                                                                 | Granica dowodu                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Ostatni pełny lokalny Vitest              | **128/128 PASS**, 15 plików, 24,18 s; lint i build PASS dla `5b0d01c`                              | Pełny zestaw obejmuje katalog źródeł, harness i limit 4 analiz; format dokumentacji sprawdzany osobno |
| Nowy katalog źródeł                       | **8 testów katalogu PASS**, objęte pełnym zestawem 120/120                                         | 8 testów zabezpieczeń harnessu włączono do późniejszego pełnego zestawu 128/128                       |
| Lokalny E2E                               | **12/12 PASS**, po 6 scenariuszy mobile i desktop                                                  | Emulacja Chromium; nie fizyczny Android                                                               |
| UI i PDF.js                               | Rzeczywisty parser odczytał dwie strony; sprawdzono daty, 7 ekranów i brak poziomego przepełnienia | Testy lokalne oraz przegląd zrzutów; 21 kombinacji ekranów przy 320/390/1440 px                       |
| PWA                                       | Manifest, ikony, rejestracja SW i brak prywatnego `/api/` w cache potwierdzone lokalnie            | Instalacja na fizycznym Androidzie niezweryfikowana                                                   |
| Wdrożenie                                 | **PASS:** https://studentos.recytator.workers.dev, strona/health 200 i anonimowe prywatne API 401  | Dostępność i ochrona endpointów nie oznaczają pełnego odbioru CRUD/AI przez HTTPS                     |
| Zdalne D1                                 | Migracje 0001–0003 zastosowane; rzeczywisty commit danych fixture potwierdzony                     | Dane testowe usunięto po bezpośredniej kontroli                                                       |
| Prawdziwy GLM                             | Trzy ukończone przebiegi czterech ról; wyniki poniżej                                              | Inne próby zakończyły się błędami walidacji; brak gwarancji powtarzalności                            |
| GitHub OAuth właściciela                  | **PASS według odbioru użytkownika:** „Tak, widzę pulpit” po świeżym logowaniu                      | Nie jest to jeszcze odbiór wszystkich funkcji telefonu ani trwałości po ponownym logowaniu            |
| Produkcyjne uwierzytelnione HTTP          | **PASS pełnego przepływu:** 36 żądań HTTPS z AI, próba 2 `38787061192`                             | Próbka produkcyjnego AI działa na Free; dokładny CPU niezmierzony                                     |
| Fizyczny Android, PWA i drugie urządzenie | **Niezweryfikowane**                                                                               | Wymagają osobnego odbioru                                                                             |

Liczby w tabeli dotyczą wskazanych, faktycznie wykonanych przebiegów. Nie sumujemy testów celowanych do liczby pełnego zestawu. Pełny zestaw 128/128 dotyczy wskazanego commitu; poprzednie 120/120 dla `422ee2f` jest wynikiem historycznym. Poprzednie sukcesy pozostają dowodem historycznym.

## Metody i granice dowodów

- Vitest sprawdza kontrakty, źródła, daty, autoryzację, limity i zachowanie błędów.
- Integracja korzysta z rzeczywistego lokalnego D1 w Miniflare/workerd i handlera aplikacji. Jedynie binding AI ma kontrolowane odpowiedzi testowe. Wyniki tych testów nie mierzą jakości modelu.
- Playwright używa Chromium: Android 390 × 844 i desktop 1440 × 1000. Produkcyjny build jest serwowany przez lokalny Worker na porcie 8899. Wydzielone D1 w `.wrangler/e2e/` jest odtwarzane bez resetowania standardowej bazy deweloperskiej.
- Oddzielny live test uruchamia ten sam handler na loopback z prawdziwymi zdalnymi bindingami AI i D1. Nie obejmuje produkcyjnego CPU, produkcyjnego HTTP ani OAuth.
- Wykonany test produkcyjny wywołuje rzeczywiste HTTPS z krótkotrwałą sesją istniejącego właściciela. Administracyjne wydanie tej sesji nie potwierdza OAuth.

Lokalny przebieg z mockiem zapisuje operacyjne metadane do `artifacts/qa-workflow-mock.json`; plik jest jawnie oznaczony. Zrzuty E2E powstają w `test-results/`. Pobieranie Chromium z CDN było zablokowane przez politykę sieci; lokalnie wykorzystano dostępną przeglądarkę systemową. GitHub CI instalował przeglądarkę Playwright niezależnie.

## Najnowszy rzeczywisty przebieg z katalogiem źródeł

[Przebieg 38786468483](https://github.com/recytator/student-os/actions/runs/38786468483), zadanie AI `116600079868`, commit `422ee2f`: **SUCCESS**, cztery role i cztery wywołania bez retry, **68,663 s**. Wszystkie obowiązki: TP 5, FP 0, FN 0; pełne daty: TP 4, FP 0, FN 0. W obu pomiarach precision, recall i F1 = 1 według dopasowania daty, strony i cytatu.

Planner zaproponował 6 bloków, po przeglądzie pozostały 4 i wszystkie 4 zapisano. Bezpośredni odczyt D1 potwierdził **4 zadania i 8 wydarzeń: 4 terminy oraz 4 bloki nauki**, 1 zatwierdzony wynik i stan `committed` po odświeżeniu. Cleanup potwierdzono. Dowód: [live-references.json](evidence/2026-10-15-live-references.json).

To pierwszy wskazany tutaj przebieg potwierdzający zapis rzeczywistych bloków nauki. Wcześniejsze przebiegi bez zaakceptowanego planu pozostają opisane oddzielnie. Test nadal używał handlera na loopback i zdalnych bindingów; nie jest pomiarem CPU wdrożonego Workera.

## Wcześniejszy rzeczywisty GLM — zestaw jednoznaczny

[Przebieg 38783763164](https://github.com/recytator/student-os/actions/runs/38783763164), zadanie `116590775923`, commit `28cd975`. Model: `@cf/zai-org/glm-4.7-flash`, z wyłączonym domyślnym thinking i zachowanym budżetem odpowiedzi.

- Cztery role ukończone w czterech wywołaniach, bez retry; całość **83,591 s**.
- Wydobyto **4 z 4 odrębnych pełnych dat**; precision i recall zbioru dat = 1. Jedna dodatkowa propozycja wymagała potwierdzenia.
- Bezpośredni odczyt zdalnego D1: **4 zadania, 4 wydarzenia, 4 ukończone kroki i 1 zatwierdzony wynik**. Odczyt po odświeżeniu zachował `committed`.
- W tym przebiegu nie zapisano bloków nauki; cztery wydarzenia są terminami, a nie zaakceptowanym planem przygotowań.
- Izolowany użytkownik fixture i jego dane zostały usunięte po kontroli. Dowód pozostał w [live-exact.json](evidence/2026-10-15-live-exact.json).

Ta metryka mierzy zbiór odrębnych dat. Nie jest pełną oceną semantycznej zgodności tytułów, źródeł ani jakości modelu na innych dokumentach.

## Rzeczywisty GLM — zestaw niepełny i konfliktowy

[Przebieg 38784929126](https://github.com/recytator/student-os/actions/runs/38784929126), zadanie `116594365113`, commit `e5d37ba`. Cztery role, cztery wywołania, **47,451 s**.

| Miara dopasowania daty, strony i cytatu | TP  | FP  | FN  | Precision | Recall | F1      |
| --------------------------------------- | --- | --- | --- | --------- | ------ | ------- |
| Obowiązki z pełną datą                  | 2   | 0   | 0   | 1         | 1      | 1       |
| Wszystkie obowiązki, także bez daty     | 3   | 0   | 1   | 1         | 0,75   | ≈ 0,857 |

Nie dopisano roku do egzaminu. Instrukcję z dokumentu próbującą utworzyć termin `01.01.2099` zignorowano. Planner zwrócił 2 bloki, ale po końcowych filtrach pozostało 0; nie jest to sukces jakości planowania. Zatwierdzenie konfliktowych danych świadomie pominięto. D1 wykazało 0 zadań i 0 wydarzeń; cleanup potwierdzono. Dowód: [live-ambiguous.json](evidence/2026-10-15-live-ambiguous.json).

Metoda dopasowuje dokładną datę, stronę i nakładający się znormalizowany cytat o długości przynajmniej 12 znaków. Nie ustala samodzielnie semantycznej tożsamości zadania. Dwa obowiązki mogą mieć tę samą datę, dlatego tej tabeli nie wolno mylić z liczbą odrębnych dat.

## Nieudane rzeczywiste próby i poprawki

- Pierwszy live test w [38782990131](https://github.com/recytator/student-os/actions/runs/38782990131) nie ukończył DocumentAgent po dwóch rezerwacjach; niczego nie zatwierdzono. Cleanup potwierdzono. Publikacja w osobnym zadaniu tego samego przebiegu zakończyła się sukcesem.
- Próby `38784110083` i `38785341330` ujawniły niedosłowne cytaty lub błędne identyfikatory ReviewAgent. Zachowano odmowę zatwierdzenia. Nie raportujemy 100% powtarzalności na podstawie dwóch udanych przypadków.
- GLM otrzymał obsługiwane `chat_template_kwargs.enable_thinking=false`; nie podniesiono budżetu 1500 tokenów.
- Backend dodał zachowawcze uzgadnianie identyfikatorów: nieznane, powtórzone, sprzeczne lub pominięte pozycje nie są automatycznie akceptowane. Pierwotny wynik modelu i metadane uzgodnienia pozostają oddzielne.
- Najnowsza poprawka źródeł pozwala modelowi wskazać `{ref_id}` z dosłownego katalogu. Serwer odtwarza stronę i cytat; istniejąca walidacja pełnych źródeł pozostaje. Poprawkę potwierdził pełny lokalny zestaw 120/120 oraz osobny nowszy przebieg live `38786468483`; wcześniejsze wyniki nadal przypisujemy ich własnym commitom.

## Pełny odbiór produkcyjnego HTTPS — AI i plan

[Przebieg 38787061192, próba 2](https://github.com/recytator/student-os/actions/runs/38787061192/attempts/2), zadanie `116604733105`: **PASS**, 36 rzeczywistych żądań HTTPS. Harness `fd04ff0` sprawdzał wdrożony Worker `5b0d01c`. CRUD, świeży odczyt, ICS/JSON, anonimowe 401 i wylogowanie sesji testowej przeszły.

Rzeczywisty GLM ukończył DocumentAgent, DeadlineAgent, PlannerAgent i ReviewAgent. Pierwsza próba DeadlineAgent nie przeszła; ograniczony retry zakończył się poprawnie. Cały run zużył **5 rezerwacji i jeden retry**. Pełne daty ze zgodną stroną i cytatem: **4/4, precision = recall = 1**. Ten pomiar nie ocenia semantyki tytułów ani obowiązków bez daty.

Zatwierdzenie i świeży odczyt potwierdziły **4 zadania i 8 wydarzeń: 4 terminy oraz 4 bloki nauki**. Wszystkie oznaczone rekordy i wyłącznie tymczasową sesję QA usunięto. Zachowano rzeczywiste `ai_usage`: przed testem 2 analizy / 5 wywołań, po teście 3 analizy / 10 wywołań, przy limitach 4/24. Jedna pozostała analiza dotyczy odczytu z **18:45:12,661 UTC, 15.10.2026**, nie bieżącej gwarancji.

Dowód zawiera bezpieczne metadane, rzeczywiste kroki oraz tokeny wejścia/wyjścia zwrócone dla ukończonych odpowiedzi: [production-ai.json](evidence/2026-10-15-production-ai.json). Brak tokenów nieudanej próby nie oznacza zerowego zużycia. Nie zapisano prywatnej treści właściciela, cookie, sekretów ani ukrytego rozumowania.

To potwierdzenie działania przetestowanego przepływu AI w produkcyjnym Workers Free, a nie tylko zdalnych bindingów na loopback. **Dokładnego CPU w ms nie zmierzono** i wynik nie gwarantuje obsługi każdego dużego PDF w limicie CPU. Sesja QA nie jest dowodem OAuth; rzeczywiste logowanie właściciela odebrano osobno.

## Pierwszy odbiór produkcyjnego HTTP — CRUD

[Przebieg 38787061192](https://github.com/recytator/student-os/actions/runs/38787061192), zadanie `116601663500`, commit `fd04ff0`: **`passed_crud_ai_skipped`**. Wykonano 19 rzeczywistych żądań HTTPS do wdrożonego Workera. Potwierdzono tożsamość istniejącego właściciela, anonimowe 401, utworzenie przedmiotu, zadania, zajęć i wydarzenia, ukończenie zadania, odczyt po odświeżeniu, eksport ICS/JSON oraz unieważnienie tymczasowej sesji po wylogowaniu. Własne rekordy i sesję testową usunięto. Dowód: [production-crud.json](evidence/2026-10-15-production-crud.json).

AI **nie zostało wywołane**: przy ówczesnym limicie 2 analiz dziennie właściciel miał już 2 rezerwacje analiz i 5 wywołań. Test poprawnie zwrócił `skipped_owner_daily_budget`, z 0 własnych wywołań, bez zerowania lub zwrotu `ai_usage`. To sukces produkcyjnego CRUD, nie pełnego przepływu AI. Liczby dotyczą chwili testu i nie opisują bieżącego pozostałego budżetu.

Żądania przechodziły przez rzeczywisty Worker i D1, więc konkretny przetestowany CRUD działał w produkcji. Dokładnego CPU nie zmierzono; test ten nie potwierdza produkcyjnego wykonania AI. Tymczasowa sesja administracyjna nie jest dowodem OAuth, które właściciel odebrał osobno.

## Wdrożenie i OAuth

Zdalne migracje początkowo ujawniły błąd transportu SQL `7500 / incomplete input`; zapis triggerów dostosowano i sprawdzono testami naruszeń własności. [38782784943](https://github.com/recytator/student-os/actions/runs/38782784943) zastosował wszystkie trzy migracje i opublikował Worker. Natychmiastowy health 404 spowodował błąd smoke; dodano ograniczone oczekiwanie na gotowość trasy.

[38782990131](https://github.com/recytator/student-os/actions/runs/38782990131), zadanie `116587705205`, potwierdził health i stronę HTTP 200 oraz bootstrap/tasks HTTP 401. Późniejszy deploy w [38785341330](https://github.com/recytator/student-os/actions/runs/38785341330), zadanie `116595770511`, również zakończył się sukcesem. Workers Free został potwierdzony przez właściciela; skrypty nie zmieniały planu ani rozliczeń.

Sekrety OAuth przekazano bezpiecznie do Workera. Pierwsza próba właściciela zwróciła GitHub 404: przekierowanie zawierało `%0A` na końcu Client ID. Poprawka `d54f502` usuwa otaczające białe znaki z obu wartości przed zapisem. Po wdrożeniu użytkownik potwierdził świeże logowanie i pulpit. Pole **Redirect URIs** jest poprawnym polem callbacku w jego UI; nie jest potrzebna nowa rejestracja aplikacji.

## Historia odtwarzalności CI

Pełne CI, wraz z E2E, przeszło m.in. w przebiegach [38737400553](https://github.com/recytator/student-os/actions/runs/38737400553), [38754614213](https://github.com/recytator/student-os/actions/runs/38754614213) i [38782987046](https://github.com/recytator/student-os/actions/runs/38782987046). Dotyczy to ich konkretnych commitów, nie automatycznie obecnego workspace.

Dwa rozbudowane testy integracyjne przekroczyły wcześniejszy limit 5000 ms na runnerze bez błędu asercji. Limit dla tych scenariuszy zwiększono do 30 000 ms, zachowując wszystkie operacje i asercje. Zwiększenie limitu testu nie zmienia budżetu CPU produkcyjnego Workera.

## Powtarzalne uruchomienie i dalszy odbiór

```bash
npm ci
node tests/fixtures/generate.mjs
npm test
npm run lint
npm run format:check
npm run build
npm run test:e2e
```

Ocena rzeczywistego eksportu:

```bash
node tests/evaluate-extraction.mjs tests/fixtures/syllabus-exact.json run-result.json
node tests/evaluate-extraction.mjs tests/fixtures/syllabus-ambiguous.json ambiguous-run-result.json
```

Do wykonania: odbiór na fizycznym Androidzie, instalacja PWA, dane po ponownym logowaniu i drugie urządzenie. Dokładnych neurons ani produkcyjnego CPU nie odczytano. Przejście testu funkcjonalnego nie jest pomiarem CPU.

## Wdrożenie limitu 4 analiz

Pełny lokalny zestaw po zmianie: **128/128 PASS**, 15 plików, 24,18 s; lint i build PASS. Commit `5b0d01c` wdrożył limit 4 analiz dziennie, zachowując 24 wywołania i wcześniejsze rezerwacje. [Przebieg 38787614257](https://github.com/recytator/student-os/actions/runs/38787614257), zadanie deploy `116603572484`: **SUCCESS**. Druga próba produkcyjnego odbioru w `38787061192` przeszła z rzeczywistym AI. [CI 38787611794](https://github.com/recytator/student-os/actions/runs/38787611794) dla `5b0d01c` również zakończyło się sukcesem, obejmując 128 testów unit/integration oraz 12 E2E. Dostępny budżet sprawdzamy świeżym odczytem serwera.

## 16.10.2026 — regresja limitu źródeł i plan GL2

Lokalnie **132/132 unit/integration PASS** (16 plików), **14/14 E2E PASS** (Chromium mobilny 390 px i desktop 1440 px), lint/format/build/typecheck PASS, pakowanie Workera dry-run PASS. Nowe testy: 35 i 45 referencji w sekcji bez utraty źródeł; nieznane ID nadal odrzucone; brak duplikowania dużych cytatów w następnym etapie; jednokrotna naprawa dopasowanego runu bez resetu ai_usage; import planu tylko dla jego właściciela, eksport, usuwanie i trwałość po odświeżeniu. Wynik rzeczywistego wdrożenia oraz kontynuacji dokumentu będzie odnotowany po ich wykonaniu. Testy kontrolowanego bindingu nadal nie są dowodem jakości prawdziwego modelu.

Dalsza kontrola produkcyjna: plan rzeczywiście zapisano w D1 i odczytano przez prywatne HTTPS. DocumentAgent zakończył się poprawnie, lecz DeadlineAgent ujawnił analogiczny nadmiar źródeł oraz pojedynczy brak poprawnego `duplicate_of`; cała analiza wtedy nie przeszła. Poprawka wymusza JSON Schema w usłudze GLM i ogranicza źródła do 3 referencji. Po tej zmianie lokalnie **134/134 unit/integration PASS**, lint/build i pakowanie Workera PASS. Nowe testy potwierdzają schemat przekazywany dostawcy oraz jednokrotne wznowienie DeadlineAgent bez powtarzania DocumentAgent i bez resetowania ai_usage. Wynik ponownego testu produkcyjnego pozostaje do odczytu.
