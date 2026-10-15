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
