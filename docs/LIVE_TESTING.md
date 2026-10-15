# Rzeczywisty test bindingów AI i D1

`scripts/live-ai-acceptance.mjs` uruchamia ten sam kod Workera na `127.0.0.1:8900`, z rzeczywistymi zdalnymi bindingami Workers AI i produkcyjnej D1. Nie stosuje mocka modelu. Test nie sprawdza produkcyjnego logowania OAuth, uwierzytelnionych żądań HTTP do wdrożonego Workera ani produkcyjnego limitu czasu CPU Workers Free. Jego przejście nie zastępuje tych kontroli.

## Warunki

- Wdrożona i w pełni zmigrowana istniejąca baza `studentos` oraz zbudowane `dist`.
- Potwierdzony Workers Free, bez aktywacji płatnego planu.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FREE_PLAN_CONFIRMED=true` w bezpiecznym środowisku GitHub Actions. Wartości nie są przekazywane jako argumenty procesu ani zapisywane w konfiguracji.
- Token musi pozwalać na dostęp do istniejącej D1 oraz zdalne bindingi Wrangler/Workers AI. Brak uprawnień kończy test komunikatem kategorii błędu; test nie rozszerza samodzielnie uprawnień.
- Zainstalowany Wrangler musi obsługiwać `d1_databases[].remote` i `ai.remote`; sprawdzane jest jego oficjalne zainstalowane schema konfiguracji. Używany projekt ma Wrangler 4.151.0.

Uruchomienie w przygotowanym runnerze:

```sh
node scripts/live-ai-acceptance.mjs
```

## Przebieg i ograniczenia

1. Odczyt identyfikatora istniejącej D1 przez Cloudflare API. Test nie tworzy usług i nie stosuje migracji.
2. Potwierdzenie, że użytkownik `local-developer` oraz GitHub ID `0` nie istnieją. W przeciwnym razie test odmawia pracy i nie usuwa tego użytkownika.
3. Tymczasowa konfiguracja bez sekretów w ignorowanym `.wrangler/`; rzeczywista aplikacja działa tylko lokalnie, oba bindingi mają `remote: true`. Nie publikuje się testowego endpointu ani mechanizmu obejścia logowania produkcyjnego.
4. Import wyłącznie publicznego `tests/fixtures/syllabus-exact.json`. Lokalny tryb developerski działa wyłącznie dla loopback i osobnego testowego użytkownika, bez dostępu do danych właściciela.
5. Rzeczywiste etapy DocumentAgent → DeadlineAgent → PlannerAgent → ReviewAgent, każde wywołanie przez osobne żądanie, wraz z ponownym odczytem punktu kontrolnego z D1.
6. Maksymalnie pięć rezerwacji wywołań na potrzeby testu, czyli standardowe cztery role i najwyżej jedna dodatkowa próba. Obowiązuje także retry/budżet orkiestratora i 180 sekund na wywołanie. Cały skrypt ma limit 12 minut, a zadanie GitHub Actions powinno mieć 15 minut. Żądanie kolejnej korekty po wykorzystaniu pięciu rezerwacji kończy test zamiast zwiększać budżet.
7. Pomiar precision/recall zbioru jednoznacznych dat względem ręcznie przygotowanego zestawu referencyjnego. Nie jest to ocena semantycznej zgodności tytułów. Częściowy wynik jest raportowany jako `partial_extraction`, a nie pełny sukces.
8. Do zatwierdzenia trafiają jedynie propozycje zaakceptowane przez ReviewAgent i walidator, z konkretną datą i bez wymagania ręcznego potwierdzenia. Skrypt nie poprawia odpowiedzi modelu i nie potwierdza niejednoznacznych informacji za użytkownika.
9. Bezpośredni odczyt D1 potwierdza zatwierdzone zadania, wydarzenia, rezultaty i rzeczywiste ukończone kroki. Odświeżenie API ponownie sprawdza stan `committed`.
10. Proces lokalny zostaje zatrzymany. Usunięcie nowo utworzonego testowego użytkownika następuje wyłącznie po ponownej kontroli tożsamości i braku obcych dokumentów, zadań, wydarzeń, przedmiotów, zajęć i sesji w jego przestrzeni. Kaskady usuwają dane fixture; klucze rate limitu tego użytkownika również są usuwane. Przy naruszeniu warunku bezpieczeństwa skrypt odmawia usunięcia i raportuje `CLEANUP_SAFETY_CHECK_REFUSED`.

## Artefakty i interpretacja

- `artifacts/live-ai/report.json`: status, faktycznie sprawdzone warunki, rezerwacje orkiestratora, ukończone odpowiedzi modeli, metryki referencyjne, liczności z D1 i wynik sprzątania.
- `artifacts/live-ai/actual-operational-run.json`: rzeczywiste, ustrukturyzowane rezultaty i operacyjne metadane etapów dotyczące publicznego fixture.

Rezerwacje orkiestratora uwzględniają nieudane próby; nie są odczytem rozliczenia dostawcy. Tokeny w logach pochodzą tylko z odpowiedzi dostawcy, jeśli je udostępnia. Nie wylicza się fikcyjnej liczby neuronów ani kosztu Cloudflare.

Surowe odpowiedzi providerów, ukryte rozumowanie modeli, tokeny, sekrety sesji i surowe wyjście CLI nie trafiają do artefaktów. Tymczasowa konfiguracja jest usuwana. Ze względu na brak anulowania wywołania bindingu po timeout dostawca może dokończyć rozpoczęte wywołanie; rezerwacja nie jest zwracana.

Stan testu rzeczywistego należy odczytać z konkretnego artefaktu uruchomienia GitHub Actions. Samo istnienie skryptu oraz przejście jego testów zabezpieczeń nie oznacza wykonania modelu, migracji produkcyjnej ani testu OAuth.

## Osobny odbiór wdrożonego HTTPS

`scripts/production-acceptance.mjs` oraz workflow **StudentOS production HTTPS acceptance** dotyczą https://studentos.recytator.workers.dev, a nie lokalnego handlera. Weryfikują rzeczywisty Worker, zasoby, CRUD, eksport JSON/ICS oraz opcjonalnie jedną analizę publicznego fixture. Druga próba zakończyła się pełnym sukcesem AI opisanym na końcu. Testy zabezpieczeń skryptu: **8/8 PASS**. Commit `fd04ff0` wykonano w przebiegu `38787061192`: 19 żądań HTTPS potwierdziło CRUD, eksporty i sprzątanie. AI pominięto z powodu rzeczywistego budżetu właściciela; [dowód](evidence/2026-10-15-production-crud.json).

Test wymaga istniejącego rekordu właściciela. Administracyjnie tworzy losową sesję na 10 minut i zapisuje do D1 wyłącznie jej hash. **Nie jest to dowód nowego logowania OAuth.** Faktyczny OAuth został osobno odebrany przez właściciela, który potwierdził pulpit po świeżym logowaniu. Test nie publikuje endpointu do obejścia logowania.

Skrypt tworzy własne oznaczone przedmiot, zajęcia, zadanie, podzadanie i wydarzenie. Po kontroli usuwa wyłącznie konkretne utworzone rekordy oraz swoją sesję. Sprawdza anonimowe 401, odrzucenie niewłaściwego Origin, utrwalenie zmian po ponownym odczycie i brak sekretów w eksporcie. Eksport może zawierać prywatne dane właściciela, dlatego raport zachowuje tylko bezpieczne wyniki kontroli, nie jego treść.

Opcjonalne AI korzysta z **prawdziwego budżetu właściciela**: 1 z 4 analiz dziennie oraz maksymalnie 5 rezerwacji wywołań. Test nie zeruje `ai_usage` i nie zwraca rezerwacji. Pomija analizę m.in. przy wyłączonym AI, braku budżetu lub aktywnej analizie użytkownika. Takie pominięcie oznacza sukces CRUD z pominiętym AI, a nie sukces pełnej analizy. Raporty trafiają do `artifacts/production-acceptance/` i są zachowywane jako artefakt workflow.

Druga próba potwierdziła działanie konkretnego przepływu CRUD i AI przez produkcyjne HTTPS. **Nie dadzą dokładnego pomiaru CPU**, jeśli telemetria nie zostanie odczytana. Nie zastąpią także fizycznego Androida, instalacji PWA ani testu drugiego urządzenia.

## Potwierdzone przebiegi bindingów

- [38783763164](https://github.com/recytator/student-os/actions/runs/38783763164): cztery role, cztery wywołania, 4 zadania i 4 wydarzenia, bez zaakceptowanych bloków nauki. [Dowód](evidence/2026-10-15-live-exact.json).
- [38784929126](https://github.com/recytator/student-os/actions/runs/38784929126): zestaw konfliktowy, 3/4 obowiązków, poprawne pełne daty, 0 bloków po filtrach; niczego nie zatwierdzano. [Dowód](evidence/2026-10-15-live-ambiguous.json).
- [38786468483](https://github.com/recytator/student-os/actions/runs/38786468483): katalog źródeł i zachowawczy ReviewAgent, cztery role i cztery wywołania w 68,663 s; 5/5 obowiązków oraz 4/4 pełnych dat przy dopasowaniu źródła i daty; 4 zapisane bloki nauki, 4 zadania i 8 wydarzeń. [Dowód](evidence/2026-10-15-live-references.json).

Istniały też nieudane rzeczywiste próby walidacji cytatów i ID. Ich historię zachowuje [TEST_REPORT.md](TEST_REPORT.md); udane wykonanie nie oznacza 100% powtarzalności modelu.

## Rzeczywisty odbiór produkcyjnego HTTP — CRUD

[Przebieg 38787061192](https://github.com/recytator/student-os/actions/runs/38787061192), zadanie `116601663500`, commit `fd04ff0`: **`passed_crud_ai_skipped`**. Wykonano 19 rzeczywistych żądań HTTPS do wdrożonego Workera. Potwierdzono tożsamość istniejącego właściciela, anonimowe 401, utworzenie przedmiotu, zadania, zajęć i wydarzenia, ukończenie zadania, odczyt po odświeżeniu, eksport ICS/JSON oraz unieważnienie tymczasowej sesji po wylogowaniu. Własne rekordy i sesję testową usunięto. Dowód: [production-crud.json](evidence/2026-10-15-production-crud.json).

AI **nie zostało wywołane**: przy ówczesnym limicie 2 analiz dziennie właściciel miał już 2 rezerwacje analiz i 5 wywołań. Test poprawnie zwrócił `skipped_owner_daily_budget`, z 0 własnych wywołań, bez zerowania lub zwrotu `ai_usage`. To sukces produkcyjnego CRUD, nie pełnego przepływu AI. Liczby dotyczą chwili testu i nie opisują bieżącego pozostałego budżetu.

Żądania przechodziły przez rzeczywisty Worker i D1, więc konkretny przetestowany CRUD działał w produkcji. Dokładnego CPU nie zmierzono; test ten nie potwierdza produkcyjnego wykonania AI. Tymczasowa sesja administracyjna nie jest dowodem OAuth, które właściciel odebrał osobno.

## Pełny odbiór produkcyjnego HTTPS — AI i plan

[Przebieg 38787061192, próba 2](https://github.com/recytator/student-os/actions/runs/38787061192/attempts/2), zadanie `116604733105`: **PASS**, 36 rzeczywistych żądań HTTPS. Harness `fd04ff0` sprawdzał wdrożony Worker `5b0d01c`. CRUD, świeży odczyt, ICS/JSON, anonimowe 401 i wylogowanie sesji testowej przeszły.

Rzeczywisty GLM ukończył DocumentAgent, DeadlineAgent, PlannerAgent i ReviewAgent. Pierwsza próba DeadlineAgent nie przeszła; ograniczony retry zakończył się poprawnie. Cały run zużył **5 rezerwacji i jeden retry**. Pełne daty ze zgodną stroną i cytatem: **4/4, precision = recall = 1**. Ten pomiar nie ocenia semantyki tytułów ani obowiązków bez daty.

Zatwierdzenie i świeży odczyt potwierdziły **4 zadania i 8 wydarzeń: 4 terminy oraz 4 bloki nauki**. Wszystkie oznaczone rekordy i wyłącznie tymczasową sesję QA usunięto. Zachowano rzeczywiste `ai_usage`: przed testem 2 analizy / 5 wywołań, po teście 3 analizy / 10 wywołań, przy limitach 4/24. Jedna pozostała analiza dotyczy odczytu z **18:45:12,661 UTC, 15.10.2026**, nie bieżącej gwarancji.

Dowód zawiera bezpieczne metadane, rzeczywiste kroki oraz tokeny wejścia/wyjścia zwrócone dla ukończonych odpowiedzi: [production-ai.json](evidence/2026-10-15-production-ai.json). Brak tokenów nieudanej próby nie oznacza zerowego zużycia. Nie zapisano prywatnej treści właściciela, cookie, sekretów ani ukrytego rozumowania.

To potwierdzenie działania przetestowanego przepływu AI w produkcyjnym Workers Free, a nie tylko zdalnych bindingów na loopback. **Dokładnego CPU w ms nie zmierzono** i wynik nie gwarantuje obsługi każdego dużego PDF w limicie CPU. Sesja QA nie jest dowodem OAuth; rzeczywiste logowanie właściciela odebrano osobno.
