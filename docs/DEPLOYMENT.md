# Wdrożenie StudentOS z telefonu

Stan: **niewdrożone w tej sesji**. Brak gotowych poświadczeń Cloudflare i aplikacji GitHub OAuth. Instrukcja dotyczy istniejącego repozytorium https://github.com/recytator/student-os.

## 1. Konto Workers Free

1. Otwórz https://dash.cloudflare.com/ i zaloguj się lub utwórz bezpłatne konto.
2. Otwórz **Workers & Pages** i ustaw bezpłatną subdomenę `workers.dev`, jeżeli konto jeszcze jej nie ma. Wybierz **Workers Free**. Nie wybieraj Paid, zakupu domeny, Unified billing ani kredytów AI Gateway.
3. W sekcji konta skopiuj **Account ID**; to identyfikator, nie hasło.
4. Otwórz https://dash.cloudflare.com/profile/api-tokens → **Create Token** → **Custom token**. Ogranicz zasób do własnego konta. Nadaj wyłącznie uprawnienia potrzebne wdrożeniu: **Account / Workers Scripts / Edit**, **Account / D1 / Edit**, **Account / Workers AI / Read** i odczyt subdomeny Workers (w interfejsie może być oznaczony jako Workers Scripts Read zawarty w Edit). Nie wymagamy dostępu do stref DNS ani rozliczeń. Jeśli API odmówi konkretnego działania, sprawdź błąd i dodaj tylko wskazane niezbędne uprawnienie.
5. Nie przesyłaj tokenu w czacie. Otwórz https://github.com/recytator/student-os/settings/secrets/actions → **New repository secret**. Zapisz token jako `CLOUDFLARE_API_TOKEN`, a Account ID jako `CLOUDFLARE_ACCOUNT_ID`.
6. Nie musisz ręcznie ustawiać właściciela: workflow przyjmuje identyfikator konta GitHub, które uruchamia wdrożenie. Dla tego projektu powinno to być konto `recytator` (`166433083`). Opcjonalna zmienna `GITHUB_OWNER_ID` w https://github.com/recytator/student-os/settings/variables/actions pozwala jawnie wskazać inne konto właściciela; nie jest sekretem.

Jeżeli Cloudflare poprosi o kartę lub zmianę planu, przerwij tę operację. Kod nie potrzebuje usług premium. Nie obniżaj zabezpieczeń sesji ani allowlisty w celu uruchomienia aplikacji.

## 2. Pierwsze wdrożenie z zamkniętym API

1. Po opublikowaniu zmian w domyślnej gałęzi otwórz https://github.com/recytator/student-os/actions → **Deploy StudentOS (Workers Free)**.
2. Wybierz **Run workflow** i potwierdź wyłącznie, jeśli konto rzeczywiście używa Workers Free.
3. Skrypt tworzy/wykorzystuje D1 `studentos`, ustala prawdziwy adres `https://studentos.<Twoja-subdomena>.workers.dev`, zapisuje konfigurację na czas joba, stosuje migracje i wdraża aplikację.
4. Brak konfiguracji OAuth pozostawia prywatne API zamknięte. To etap konfiguracji, a nie ukończona aplikacja produkcyjna. Adres odczytaj z kroku **Prepare** lub Cloudflare Workers & Pages → `studentos` → Visit.

Nie uruchamiaj ręcznie `wrangler deploy` z nieuzupełnionym `wrangler.jsonc`: zerowy UUID jest świadomym lokalnym placeholderem. Workflow generuje poprawny plik i nie zapisuje sekretów do niego.

## 3. GitHub OAuth

1. Zapisz rzeczywisty adres z poprzedniego kroku.
2. Otwórz https://github.com/settings/applications/new (na telefonie w razie potrzeby włącz „Wersja na komputer”).
3. **Application name:** `StudentOS`. **Homepage URL:** rzeczywisty adres aplikacji. **Authorization callback URL:** ten sam adres z końcówką `/api/auth/callback`.
4. Zarejestruj aplikację. Dodaj **Client ID** jako GitHub Actions Secret `STUDENTOS_GITHUB_CLIENT_ID`.
5. Wybierz **Generate a new client secret**. Zapisz go bezpośrednio jako Secret `STUDENTOS_GITHUB_CLIENT_SECRET`. Nie przesyłaj sekretu do czatu.
6. Ponownie uruchom workflow wdrożenia. Sekrety zostaną przekazane do Worker Secrets przez stdin, nigdy w argumentach poleceń. Zalogować może się wyłącznie `GITHUB_OWNER_ID`.

Konfiguracja serwera: `APP_ORIGIN` i `GITHUB_OWNER_ID` jako zmienne, `GITHUB_CLIENT_ID` i `GITHUB_CLIENT_SECRET` jako sekrety. `DEV_AUTH=false` w wygenerowanej konfiguracji produkcyjnej.

## 4. Test odbiorczy z telefonu

1. Wejdź w adres aplikacji i zaloguj się. Na niezalogowanej karcie `/api/bootstrap` musi zwracać 401.
2. Dodaj przedmiot, cykliczne zajęcia, zadanie i podzadanie; oznacz zadanie jako wykonane. Odśwież, wyloguj i zaloguj się ponownie. Dane muszą pozostać.
3. Pobierz `tests/fixtures/syllabus-exact.pdf` z repozytorium, zaimportuj go w Dokumentach. Oryginalny PDF nie jest wysyłany; przesyłany jest tekst i strony.
4. Uruchom analizę, przejdź etapy aż do ReviewAgent, sprawdź prawdziwy model i logi, źródła, daty oraz propozycje. Zatwierdź wybrane zadania. Sprawdź ich zapis i kalendarz.
5. Powtórz import; dokument nie powinien się powielić. Sprawdź drugi PDF z niepełnymi danymi i eksport ICS/JSON.
6. Przerwij połączenie podczas analizy i odśwież; wznowienie powinno kontynuować zapisany etap. Nie usuwaj danych produkcyjnych w trakcie testu.
7. Zapisz rzeczywiste wyniki oraz tokeny z odpowiedzi dostawcy do raportu. Dokładne wykorzystanie Neurons odczytaj w panelu Cloudflare Workers AI; aplikacja nie udaje dostępu do tego odczytu.

## Koszty i rollback

Włączony Workers Free zatrzymuje operacje po wyczerpaniu limitów, bez automatycznej aktywacji Paid. To zależy od faktycznego planu konta, którego ten skrypt nie zmienia. Konto już korzystające z Paid może mieć inne zasady rozliczeń; takiego wdrożenia nie autoryzowano. Limity aplikacji nie zastępują sprawdzenia planu.

Nie wykonuj destrukcyjnych migracji. Przed późniejszymi zmianami schematu wyeksportuj dane, zachowaj istniejące migracje i przetestuj nową migrację lokalnie. Rollback kodu: poprzednia wersja Worker w Cloudflare → Deployments; zgodność ze schematem sprawdź przed przywróceniem. Eksport JSON jest w ustawieniach aplikacji.

## Automatyczna kontrola dostępu

Workflow **Check deployment access (no changes)** sprawdza w środowisku GitHub Actions obecność wymaganych sekretów i możliwość odczytu subdomeny Cloudflare. Nie wypisuje ich wartości, nie tworzy zasobów i nie wywołuje AI. Status `blocked` oznacza brak konfiguracji lub dostępu, a `ready_for_initial_deployment` oznacza wyłącznie gotowość do rozpoczęcia wdrożenia, nie ukończoną publikację ani potwierdzenie planu Free.

## Uruchomienie nadzorowane przez agenta

Po jednoznacznym potwierdzeniu przez właściciela konta Workers Free i skonfigurowaniu sekretów można uruchomić ten sam workflow, publikując zweryfikowany commit na gałęzi `deploy/studentos`. Wyłącznie ta gałąź ma automatyczny trigger publikacji; zwykły push na `main` nie uruchamia wdrożenia. Ręczne `workflow_dispatch` nadal wymaga potwierdzenia Free. Gałąź wdrożeniowa nie zmienia prawdziwego planu konta i nie upoważnia do aktywowania Paid.
