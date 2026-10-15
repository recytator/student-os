# Odbiór StudentOS — zgodność z kryteriami użytkownika

Stan **15.10.2026**: aplikacja jest wdrożona pod https://studentos.recytator.workers.dev, a rdzeń jest sprawdzony przez produkcyjne HTTPS: CRUD, eksporty, cztery rzeczywiste role GLM i zapis zadań oraz bloków nauki. Właściciel potwierdził udane OAuth i pulpit. Pozostają osobne kontrole fizycznego Androida/PWA, danych po ponownym logowaniu i drugiego urządzenia. Dokładnego CPU w ms nie zmierzono; przetestowany przepływ AI wykonał się poprawnie na Workers Free.

Zestawienie rozdziela obecność implementacji i lokalny dowód od odbioru produkcyjnego. Ostateczne liczby testów i scenariusze urządzeń pochodzą z [TEST_REPORT.md](TEST_REPORT.md); ich brak w tym pliku nie oznacza testu zaliczonego. Instrukcja konfiguracji i odtwarzania wdrożenia: [DEPLOYMENT.md](DEPLOYMENT.md).

## Kryteria ukończenia z wymagania użytkownika

| Kryterium                        | Stan implementacji                                           | Potwierdzony odbiór i pozostały zakres                                                                                           |
| -------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Rzeczywisty adres internetowy    | Worker, Static Assets i CI/CD                                | **PASS:** https://studentos.recytator.workers.dev, health/strona 200, prywatne API 401                                           |
| Logowanie z telefonu             | GitHub OAuth, PKCE, allowlista i sesja HttpOnly              | **PASS logowania właściciela:** użytkownik potwierdził pulpit; pełny odbiór fizycznego Androida jest osobny                      |
| Utworzenie przedmiotu            | Formularze, CRUD, walidacja i własność                       | **PASS produkcyjnego HTTPS:** przebieg `38787061192`                                                                             |
| Zapis planu zajęć                | Cykliczne zajęcia z godzinami i zakresem dat                 | **PASS produkcyjnego HTTPS**; pełny odbiór fizycznego telefonu pozostaje                                                         |
| Utworzenie i zakończenie zadania | CRUD, status, priorytet i podzadania                         | **PASS produkcyjnego HTTPS:** przebieg `38787061192`                                                                             |
| Import tekstowego PDF            | PDF.js, walidacja pliku i tekstu                             | **PASS lokalnego E2E:** rzeczywisty parser; odbiór na fizycznym telefonie pozostaje                                              |
| Analiza przez działający AI      | Binding `AI.run`, konfigurowalny model                       | **PASS produkcyjnego HTTPS:** rzeczywisty GLM w próbie 2 `38787061192`                                                           |
| Czterej agenci wykonują role     | Cztery prompty, kontrakty i walidatory                       | **PASS produkcji:** 4 ukończone role, 5 rezerwacji z jednym retry DeadlineAgent                                                  |
| Orkiestrator przekazuje wyniki   | Checkpointy, osobne HTTP i bounded retry                     | **PASS produkcji:** kolejne etapy, checkpointy, retry i odczyt po zatwierdzeniu                                                  |
| Kontrola dat i źródeł            | Cytaty, pełne daty, katalog referencji i niezależny przegląd | Najnowszy jednoznaczny zestaw: 5/5 obowiązków i 4/4 pełnych dat; konfliktowy: 3/4 obowiązków. Nie dowodzi uniwersalnej trafności |
| Korekta i zatwierdzanie          | Edytowalne propozycje i serwerowa kontrola                   | **PASS produkcyjnego zatwierdzenia:** D1 i świeży odczyt; ręczna korekta na telefonie do odbioru                                 |
| Zapis zatwierdzonych danych w D1 | Atomowe batch, deduplikacja i idempotencja                   | **PASS:** najnowszy test zapisał 4 zadania i 8 wydarzeń, w tym 4 bloki nauki                                                     |
| Dane po ponownym zalogowaniu     | Trwałe tabele i odczyt z serwera                             | Stan `committed` po odświeżeniu sprawdzony; wylogowanie/logowanie z danymi i drugie urządzenie do odbioru                        |
| Rzeczywisty przebieg agentów     | `agent_runs`, `agent_steps` i ekran Activity                 | **PASS:** rzeczywiste kroki i tokeny ukończonych odpowiedzi w `production-ai.json`; dane testowe usunięto                        |
| Główne funkcje na telefonie      | Mobile-first, dolna nawigacja i safe areas                   | **PASS emulacji:** 12/12 E2E mobile/desktop; fizyczny Android niezweryfikowany                                                   |
| Podstawowe testy                 | Vitest, D1, auth i E2E                                       | Ostatni pełny lokalny wynik **128/128 PASS**, 15 plików; wcześniejsze 120/120 pozostaje wynikiem historycznym                    |
| Dokumentacja zgodna ze stanem    | Architektura, proces, prezentacja i dowody                   | Rozdziela sukcesy, nieudane próby i niewykonane kontrole; checkpoint w `CONTINUATION.md`                                         |
| Darmowe utrzymanie               | Workers Free, limity, brak płatnego API                      | Plan potwierdzony przez właściciela; dokładne zużycie neurons i CPU niezmierzone                                                 |

## Dodatkowe zabezpieczenia i dowody

- Autoryzacja i prywatność: anonimowe API jest blokowane, mutacje wymagają właściwego Origin, zapytania filtrują właściciela, a triggery D1 odrzucają relacje między użytkownikami. Rzeczywiste OAuth potwierdził właściciel; testowa sesja administracyjna nie zastępuje tego dowodu.
- Bezpieczeństwo danych: sesja przechowywana w D1 jako SHA-256, sekrety poza repozytorium; eksport nie zawiera sesji ani OAuth state.
- Koszty: 4 analizy i 24 wywołania AI dziennie na użytkownika, 12 wywołań na run, jeden retry; input do 64 000 znaków JSON, output 1500 tokenów. To budżety aplikacji, nie dokładny odczyt neurons lub kosztu PLN.
- D1 Free: upload stron i zatwierdzanie wielu elementów wykorzystują grupowanie wielowierszowe, aby pozostać poniżej 50 zapytań na wywołanie i 100 parametrów na zapytanie.
- Konkurencja: lease kroków oraz migracja `0002_one_active_run.sql` z częściowym indeksem UNIQUE ograniczają równoległe aktywne wykonania jednego dokumentu.
- Błędy AI: niepoprawny JSON, nieistniejące cytaty i wyczerpanie budżetu zatrzymują analizę; dokument oraz ręczne CRUD pozostają dostępne w granicach limitów infrastruktury.
- Deduplikacja: hash tekstu przeliczany przez serwer, izolacja właściciela, unikalne propozycje i idempotentne zatwierdzenie.

## Znane ograniczenia wersji

1. **Brak OCR.** Skan bez warstwy tekstowej wymaga zewnętrznego przygotowania tekstowego PDF; aplikacja nie tworzy fikcyjnych wyników.
2. **Oryginalny PDF tylko na urządzeniu.** D1 przechowuje tekst stron, metadane i wyniki. Pełny dokument nie pojawi się na drugim urządzeniu.
3. **Brak CRUD offline.** PWA zapewnia instalację i komunikat o braku połączenia; nie buforuje prywatnych odpowiedzi API jako działającej bazy offline.
4. **Ograniczony zakres pomiaru jakości.** Najnowszy zestaw jednoznaczny uzyskał 5/5 obowiązków i 4/4 pełnych dat przy dopasowaniu daty, strony i cytatu. Zestaw konfliktowy uzyskał 3/4 obowiązków, a wcześniejsze próby nie zawsze przechodziły walidację. Nie deklarujemy 100% powtarzalności ani uniwersalnej jakości modelu.
5. **Podział dokumentu jest znakowy.** Fragmenty bazowe po 30 000 znaków mają kontekst sąsiadów po 800 znaków i zachowują numery stron. Nie jest to parser semantycznej struktury; zdania przy granicy nadal mogą utrudnić ekstrakcję.
6. **Ograniczony kontekst ReviewAgent.** Model widzi sprawdzone cytaty oraz pierwszą strukturę dokumentową, podczas gdy walidator deterministyczny ma pełny tekst.
7. **Brak automatycznego przeliczenia AI po zmianie danych.** Cache uwzględnia snapshot zadań, wydarzeń, zajęć i preferencji; aktywny run jest ponownie używany, chyba że użytkownik jawnie zleci ponowną analizę. Zatwierdzenie zawsze sprawdza aktualne konflikty. Zmiana daty zatwierdzonego zadania synchronizuje jego wydarzenie i usuwa stare powiązane bloki z oznaczeniem potrzeby ponownego planowania. Nowe bloki nauki wymagają ponownej analizy; nie powstają same.
8. **Brak gwarantowanego background job.** Klient wykonuje kolejne kroki HTTP. Zamknięcie aplikacji zatrzymuje kontynuację po zapisanym etapie.
9. **`failed` jest stanem terminalnym.** Checkpointy i logi pozostają, ale nowe podejście wymaga nowego run i nowej rezerwacji dziennego budżetu.
10. **Granice infrastruktury Free.** Przetestowany przepływ AI przeszedł przez produkcyjny Worker. Dokładnego CPU w ms nie zmierzono; nie gwarantujemy obsługi każdego dużego dokumentu w limicie. Konta Free mają wspólne limity i mogą czasowo odmawiać operacji.
11. **Powiadomienia, import USOS i poczta są poza rdzeniem.** Nie są zastępowane przyciskami udającymi działającą integrację.
12. **Ekstrakcja terminów ma dokładność dnia.** Cytaty zachowują godziny zapisane w PDF, ale propozycje zadań używają `due_date`, a ich wydarzenia terminowe są całodniowe. Dokładne godziny wydarzeń i cykliczne zajęcia można wprowadzać ręcznie. Test konfliktowego sylabusa nie dowodzi automatycznej ekstrakcji godzin zajęć.

## Pozostały odbiór

Konfiguracja kont, deploy, migracje i logowanie właściciela są wykonane. Produkcyjny CRUD, eksporty i AI są potwierdzone. Zwykłe korzystanie nie wymaga kolejnej rejestracji lub autoryzacji. Pozostało przeprowadzić na fizycznym Androidzie: przedmiot i zajęcia → zadanie i ukończenie → import PDF → rzeczywista analiza → ręczna korekta → zatwierdzenie → ponowne logowanie i drugie urządzenie → brak duplikatów → JSON/ICS → instalacja PWA. Nie powtarzaj rejestracji OAuth ani nie zeruj dziennego budżetu AI.

Dla każdego kroku dopisać do raportu datę, środowisko, wynik i dowód: adres aplikacji, ID uruchomienia lub plik testowy. **Dopiero po pozytywnym odbiorze całej ścieżki można uznać produkt za ukończony według kryteriów użytkownika.**
