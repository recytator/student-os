# Odbiór StudentOS — zgodność z kryteriami użytkownika

Stan: **implementacja w lokalnej weryfikacji, produkt nie jest jeszcze odebrany jako wdrożony**. Brak potwierdzonego publicznego adresu, produkcyjnego OAuth i analizy na rzeczywistym Workers AI blokuje końcowe kryteria. Nie zastępujemy ich lokalnym logowaniem developerskim ani odpowiedziami testowego modelu.

Zestawienie rozdziela obecność implementacji i lokalny dowód od odbioru produkcyjnego. Ostateczne liczby testów i scenariusze urządzeń pochodzą z [TEST_REPORT.md](TEST_REPORT.md); ich brak w tym pliku nie oznacza testu zaliczonego. Instrukcja odblokowania chmury: [DEPLOYMENT.md](DEPLOYMENT.md).

## Kryteria ukończenia z wymagania użytkownika

| Kryterium                             | Stan implementacji i dowód lokalny                                                            | Stan odbioru produkcyjnego                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Rzeczywisty adres internetowy         | Worker, Static Assets, workflow wdrożenia i smoke test przygotowane                           | **Zablokowane:** konfiguracja i autoryzacja Cloudflare; nie podano fikcyjnego URL                |
| Logowanie z telefonu                  | GitHub OAuth z PKCE, allowlista właściciela, sesja HttpOnly i testy auth                      | **Zablokowane:** rejestracja OAuth App, sekrety i prawdziwy callback                             |
| Utworzenie przedmiotu                 | Formularze i CRUD API z walidacją oraz `user_id`                                              | Lokalna warstwa danych testowana; odbiór na docelowym telefonie po wdrożeniu                     |
| Zapis planu zajęć                     | Cykliczne zajęcia z lokalnymi godzinami, dniem tygodnia i zakresem dat                        | Produkcyjne utrwalenie i widok telefonu do sprawdzenia                                           |
| Utworzenie i zakończenie zadania      | CRUD, priorytety, termin, status i podzadania                                                 | Produkcyjne utrwalenie do sprawdzenia                                                            |
| Import tekstowego PDF                 | PDF.js na urządzeniu, kontrola formatu, rozmiaru, liczby stron i tekstu; fixture PDF          | Rzeczywisty import w docelowej przeglądarce wymaga potwierdzenia scenariuszem E2E i telefonu     |
| Analiza przez działający silnik AI    | Binding `AI.run`, konfigurowalny model i kontrakty                                            | **Niezaliczone:** brak rzeczywistego wywołania modelu na koncie Cloudflare                       |
| Czterej agenci wykonują role          | Cztery prompty i osobne schematy; test przepływu z jawnymi odpowiedziami fixture              | Integracja ról testowana lokalnie; **live AI niezweryfikowane**                                  |
| Orkiestrator przekazuje wyniki        | D1 checkpointy, osobne kroki HTTP, przekazywanie typowanych danych i bounded retry            | Lokalny workflow testowany; pełny przepływ produkcyjny do wykonania                              |
| Kontrola dat i źródeł                 | Zod, dosłowny cytat na stronie, pełna data w źródle, ReviewAgent i walidator deterministyczny | Testy reguł dostępne; jakość ekstrakcji prawdziwego modelu **niezmierzona**                      |
| Korekta i zatwierdzanie wyników       | Edytowalne propozycje, wybór bloków i serwerowa walidacja; `user_confirmed` dla ręcznej daty  | Produkcyjny przepływ człowiek → API do sprawdzenia                                               |
| Zapis zatwierdzonych danych w D1      | Atomowe `DB.batch`, deduplikacja i idempotencja; rzeczywisty lokalny D1 Miniflare             | Lokalnie potwierdzane; **zdalne D1 niezweryfikowane**                                            |
| Dane po ponownym zalogowaniu          | Trwałe tabele i odczyt z checkpointu; brak zależności od localStorage jako autoryzacji        | **Niezweryfikowane:** wymagane realne wylogowanie/logowanie oraz drugie urządzenie               |
| Rzeczywisty przebieg pracy agentów    | `agent_runs` i `agent_steps` powstają wokół wykonywanych kroków; UI odczytuje zapisane logi   | Lokalne logi z testowego bindingu są oznaczane jako testowe; brak udawanego logu produkcyjnego   |
| Użyteczne główne funkcje na telefonie | Dolna nawigacja, safe areas, responsywne ekrany i PWA                                         | Końcowe testy mobilne/desktopowe należy odczytać w raporcie; sam build nie jest odbiorem UI      |
| Podstawowe testy przechodzą           | Unit, auth, lokalne D1 i testy workflow istnieją i są wykonywane                              | Dokładny wynik końcowy w `TEST_REPORT.md`; testy produkcyjne osobno                              |
| Dokumentacja zgodna ze stanem         | Architektura, agenci, proces, decyzje, badanie Free, prezentacja i instrukcja telefonu        | Dokumentacja jawnie wykazuje blokady i nie deklaruje ukończenia wdrożenia                        |
| Utrzymanie na darmowym planie         | Brak płatnego API i aktywacji Paid, własne limity, etapowy workflow, grupowanie zapytań D1    | **Warunkowe:** właściciel musi potwierdzić Workers Free; rzeczywiste zużycie i CPU do zmierzenia |

## Dodatkowe zabezpieczenia i dowody

- Autoryzacja i prywatność: anonimowe API jest blokowane, mutacje wymagają właściwego Origin, zapytania filtrują właściciela, a triggery D1 odrzucają relacje między użytkownikami. Lokalne testy nie potwierdzają jeszcze prawdziwego OAuth.
- Bezpieczeństwo danych: sesja przechowywana w D1 jako SHA-256, sekrety poza repozytorium; eksport nie zawiera sesji ani OAuth state.
- Koszty: 2 analizy i 24 wywołania AI dziennie na użytkownika, 12 wywołań na run, jeden retry; input do 64 000 znaków JSON, output 1500 tokenów. To budżety aplikacji, nie dokładny odczyt neurons lub kosztu PLN.
- D1 Free: upload stron i zatwierdzanie wielu elementów wykorzystują grupowanie wielowierszowe, aby pozostać poniżej 50 zapytań na wywołanie i 100 parametrów na zapytanie.
- Konkurencja: lease kroków oraz migracja `0002_one_active_run.sql` z częściowym indeksem UNIQUE ograniczają równoległe aktywne wykonania jednego dokumentu.
- Błędy AI: niepoprawny JSON, nieistniejące cytaty i wyczerpanie budżetu zatrzymują analizę; dokument oraz ręczne CRUD pozostają dostępne w granicach limitów infrastruktury.
- Deduplikacja: hash tekstu przeliczany przez serwer, izolacja właściciela, unikalne propozycje i idempotentne zatwierdzenie.

## Znane ograniczenia wersji

1. **Brak OCR.** Skan bez warstwy tekstowej wymaga zewnętrznego przygotowania tekstowego PDF; aplikacja nie tworzy fikcyjnych wyników.
2. **Oryginalny PDF tylko na urządzeniu.** D1 przechowuje tekst stron, metadane i wyniki. Pełny dokument nie pojawi się na drugim urządzeniu.
3. **Brak CRUD offline.** PWA zapewnia instalację i komunikat o braku połączenia; nie buforuje prywatnych odpowiedzi API jako działającej bazy offline.
4. **Brak pomiaru jakości rzeczywistej ekstrakcji.** Są dwa zestawy referencyjne i evaluator precision/recall/F1; wynik fixture/mooka nie jest wynikiem Workers AI.
5. **Podział dokumentu jest znakowy.** Fragmenty bazowe po 30 000 znaków mają kontekst sąsiadów po 800 znaków i zachowują numery stron. Nie jest to parser semantycznej struktury; zdania przy granicy nadal mogą utrudnić ekstrakcję.
6. **Ograniczony kontekst ReviewAgent.** Model widzi sprawdzone cytaty oraz pierwszą strukturę dokumentową, podczas gdy walidator deterministyczny ma pełny tekst.
7. **Brak automatycznego przeliczenia AI po zmianie danych.** Cache uwzględnia snapshot zadań, wydarzeń, zajęć i preferencji; aktywny run jest ponownie używany, chyba że użytkownik jawnie zleci ponowną analizę. Zatwierdzenie zawsze sprawdza aktualne konflikty. Zmiana daty zatwierdzonego zadania synchronizuje jego wydarzenie i usuwa stare powiązane bloki z oznaczeniem potrzeby ponownego planowania. Nowe bloki nauki wymagają ponownej analizy; nie powstają same.
8. **Brak gwarantowanego background job.** Klient wykonuje kolejne kroki HTTP. Zamknięcie aplikacji zatrzymuje kontynuację po zapisanym etapie.
9. **`failed` jest stanem terminalnym.** Checkpointy i logi pozostają, ale nowe podejście wymaga nowego run i nowej rezerwacji dziennego budżetu.
10. **Granice infrastruktury Free pozostają mierzalnym ryzykiem.** Lokalne testy nie dowodzą zmieszczenia wszystkich żądań w 10 ms CPU produkcyjnego Workera. Konta Free mają wspólne limity i mogą czasowo odmawiać operacji.
11. **Powiadomienia, import USOS i poczta są poza rdzeniem.** Nie są zastępowane przyciskami udającymi działającą integrację.

## Odbiór po konfiguracji kont

Wykonać kolejno: rzeczywisty deploy i migracje → anonimowe API 401 → OAuth właściciela → przedmiot i zajęcia → zadanie i ukończenie → import tekstowego PDF → cztery role na prawdziwym modelu → źródła i raport → ręczna korekta → zatwierdzenie D1 → ponowne logowanie i drugie urządzenie → ponowny import bez duplikatów → JSON/ICS → test limitu AI → instalacja PWA na Androidzie.

Dla każdego kroku dopisać do raportu datę, środowisko, wynik i dowód: adres aplikacji, ID uruchomienia lub plik testowy. **Dopiero po pozytywnym odbiorze całej ścieżki można uznać produkt za ukończony według kryteriów użytkownika.**
