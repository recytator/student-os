# Bezpieczna kontynuacja StudentOS

Checkpoint: **15.10.2026, po odbiorze produkcyjnym**. Projekt: `/workspace/student-os`; repozytorium: https://github.com/recytator/student-os. Nie inicjalizuj ponownie ani nie resetuj produkcyjnej bazy.

## Potwierdzony stan

- **Aplikacja:** https://studentos.recytator.workers.dev, wdrożona na potwierdzonym przez właściciela Workers Free.
- **OAuth:** właściciel po świeżym logowaniu potwierdził „Tak, widzę pulpit”. Wcześniejszy GitHub 404 wynikał z `%0A` na końcu Client ID; poprawka `d54f502` usuwa otaczające białe znaki. Pole **Redirect URIs** jest poprawne; nie trzeba ponownie rejestrować aplikacji.
- **Aktualny Worker:** commit `5b0d01c`, [deploy 38787614257](https://github.com/recytator/student-os/actions/runs/38787614257), zadanie `116603572484` zakończone sukcesem.
- **D1:** baza `studentos`, UUID `3655ea82-fdf2-45ac-9746-6080bfd37865`; migracje 0001–0003 zastosowane. Zachowaj je jako niezmienne.
- **Testy:** pełne 128/128 unit/integration i 12/12 E2E; [CI 38787611794](https://github.com/recytator/student-os/actions/runs/38787611794) dla `5b0d01c` zakończone sukcesem. Lokalnie lint i build również przeszły.
- **Pełny odbiór produkcyjnego HTTPS:** [38787061192, próba 2](https://github.com/recytator/student-os/actions/runs/38787061192/attempts/2), zadanie `116604733105`, status `passed`. 36 żądań potwierdziło CRUD, utrwalenie po świeżym odczycie, ICS/JSON, anonimowe 401 oraz rzeczywisty GLM.
- **AI w produkcji:** cztery ukończone role, 5 rezerwacji i jeden retry DeadlineAgent; 4/4 pełnych dat ze zgodną stroną i cytatem, precision i recall = 1. Zapisano 4 zadania i 8 wydarzeń: 4 terminy oraz 4 bloki nauki. Zatwierdzenie i ponowny odczyt są potwierdzone. [Trwały dowód](evidence/2026-10-15-production-ai.json).

## Budżety i bezpieczeństwo

Aktualnie: **4 analizy i 24 wywołania dziennie**, 12 wywołań na run, jeden retry, 1500 tokenów odpowiedzi, 64 000 znaków danych wejściowych. Nie resetuj `ai_usage` ani nie zwracaj rezerwacji. Raport z **18:45:12,661 UTC** pokazywał po teście 3 analizy i 10 wywołań, czyli 1 pozostałą analizę; jest to historyczny odczyt, nie obietnica bieżącego budżetu.

Test produkcyjny używał istniejącego właściciela i sesji wydanej administracyjnie na 10 minut. Nie był testem OAuth; rzeczywiste OAuth odebrał właściciel osobno. Usunięto wyłącznie oznaczone rekordy testu i jego sesję. Zachowano rzeczywiste użycie AI. Dane i sekrety właściciela nie trafiły do dowodu.

Sekrety są w GitHub Actions i Worker Secrets; nie proś o nie w czacie. Lokalny `gh` nie ma działającego tokenu, ale `git push` oraz GitHub connector działają. Nie omijaj polityki sieci workspace. Push `main` uruchamia CI, `deploy/studentos` publikuje, a `qa/production` uruchamia odbiór produkcyjny, który może zużyć prawdziwy budżet AI. Nie ponawiaj go bez potrzeby.

## Historia, której nie wolno ukrywać

Wcześniejsze próby ujawniły błędne cytaty i identyfikatory ReviewAgent. Dodano katalog dosłownych źródeł `{ref_id}`, zachowawcze uzgadnianie ID oraz cache v2, bez osłabiania kontroli. Sukces najnowszego testu nie oznacza 100% powtarzalności modelu.

Dowody loopback ze zdalnymi bindingami: [pierwszy zestaw](evidence/2026-10-15-live-exact.json), [zestaw konfliktowy](evidence/2026-10-15-live-ambiguous.json), [katalog źródeł](evidence/2026-10-15-live-references.json). Pierwsza produkcyjna próba sprawdziła CRUD, lecz pominęła AI przez ówczesny limit 2 analiz: [production-crud.json](evidence/2026-10-15-production-crud.json). Druga próba sprawdziła pełne AI i plan.

## Co pozostaje

Rdzeń jest wdrożony i sprawdzony przez produkcyjne HTTPS; zwykłe korzystanie nie wymaga kolejnej rejestracji ani autoryzacji. Osobno pozostają niezweryfikowane: instalacja PWA na fizycznym Androidzie, pełny odbiór telefonu, trwałość po wylogowaniu i ponownym logowaniu oraz drugie urządzenie.

Dokładnego CPU w ms i neurons nie zmierzono. Przetestowany zestaw z AI wykonał się poprawnie na produkcyjnym Workers Free, co potwierdza wykonalność tej próbki; nie gwarantuje zmieszczenia każdego dużego PDF w limitach. Nie ma OCR, CRUD offline ani automatycznego przeliczenia bloków po zmianie terminu.

Kontynuuj od rzeczywistego problemu lub kolejnego odbioru, bez powtarzania zakończonych testów dla samego powtórzenia. Czytaj [TEST_REPORT.md](TEST_REPORT.md), [ACCEPTANCE.md](ACCEPTANCE.md), [LIVE_TESTING.md](LIVE_TESTING.md) i [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md). Nie commituj plików podczas edycji przez innego agenta.

## Aktualizacja 16.10.2026 — naprawa zgłoszona ze zdjęcia

Przygotowano poprawkę limitu źródeł DocumentAgent i cache v3, migrację 0005 wznawiającą wyłącznie dopasowane przerwane analizy oraz migrację 0004 importującą plan GI1/GL2 właściciela. Plan w Kalendarzu jest transkrypcją z oznaczonymi nieznanymi tygodniami, nie cyklem potwierdzonych dat; nie jest jeszcze podstawą zajętości planera AI. Właściciel podał początek 04.10.2026, nie podał końca. Szczegóły i ograniczenia: końcowy wpis [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md). Nie powtarzaj migracji jako ręcznego importu i nie uruchamiaj kolejnych analiz publicznego fixture bez potrzeby. Wynik wdrożenia zostanie odnotowany po jego wykonaniu.

Pierwsze wdrożenie `df13335` zapisało plan i naprawiło DocumentAgent, lecz test produkcyjny ujawnił ten sam nadmiar źródeł w DeadlineAgent. Przygotowano JSON Schema u dostawcy GLM (3 źródła, wymagane pola), cache v4 oraz migrację 0006 wznawiającą DeadlineAgent bez powtarzania ekstrakcji dokumentu. Lokalnie 134/134 testy PASS; poprzednie pełne E2E 14/14 i CI `38894310514` PASS. Śledź końcowy wynik publikacji w dzienniku; nie ukrywaj nieudanej pierwszej kontynuacji.
