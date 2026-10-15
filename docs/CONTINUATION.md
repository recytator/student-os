# Bezpieczna kontynuacja StudentOS

Checkpoint 15.10.2026 po integracji i lokalnym QA. Repozytorium: https://github.com/recytator/student-os. Projekt znajduje się w `/workspace/student-os`; nie inicjalizuj go ponownie.

## Co jest sprawdzone

- 56/56 testów jednostkowych i integracyjnych z rzeczywistym lokalnym D1. Odpowiedzi AI są jawnie testowe.
- 12/12 E2E z rzeczywistym zbudowanym frontendem i Workerem, na mobilnym i desktopowym Chromium.
- Import i parsowanie dwóch stron PDF.js, CRUD, odświeżenie, źródła, zatwierdzanie, izolacja, CSRF, limity i migracje.
- Dodatkowa kontrola Supervisora: 21 kombinacji siedmiu ekranów i szerokości 320/390/1440 px; bez overflow i nieobsłużonych błędów przeglądarki. Zrzuty lokalne: `artifacts/qa-review/`.
- TypeScript strict, ESLint, Prettier, build i Wrangler dry-run. Worker: około 43 KiB gzip; konfiguracja produkcyjna ma `DEV_AUTH=false`.
- Pełne `npm audit`: 0 zgłoszonych podatności podczas tej sesji.

Dowody i konkretne ograniczenia: [TEST_REPORT.md](TEST_REPORT.md), [ACCEPTANCE.md](ACCEPTANCE.md). Nie oznaczaj tych dowodów jako produkcyjnych.

## Co blokuje następny etap

`wrangler whoami` zwrócił „You are not authenticated”. Konfiguracja środowiska nie udostępnia gotowej tożsamości ani sekretów Cloudflare. Nie ma skonfigurowanej aplikacji GitHub OAuth. Publiczne wdrożenie, prawdziwe wywołanie Workers AI, zdalne migracje D1 i fizyczny Android pozostają niezweryfikowane.

## Następne działania po konfiguracji użytkownika

1. Odczytaj [DEPLOYMENT.md](DEPLOYMENT.md). Sekrety należą do GitHub Actions Secrets albo Worker Secrets, nigdy do czatu.
2. Potwierdź Workers Free. Nie aktywuj Paid ani AI Gateway credits. Uruchom przygotowany workflow wdrożenia.
3. Odczytaj rzeczywisty URL z ukończonego wdrożenia, skonfiguruj callback GitHub OAuth i uruchom workflow ponownie.
4. Zaloguj się i wykonaj scenariusz odbioru z dokumentacji: PDF → cztery role → źródła → zatwierdzenie → D1 → ponowne logowanie.
5. Pobierz wynik rzeczywistej analizy i uruchom evaluator względem obu zestawów referencyjnych. Zapisz precision/recall/F1 dopiero dla tego wyniku; plik z mockiem nie stanowi oceny modelu.
6. Zmierz CPU i wykorzystanie konta w Cloudflare. Tokeny w odpowiedzi nie są dokładnym odczytem Neurons ani rachunkiem.
7. Sprawdź PWA na fizycznym Androidzie i synchronizację na drugim urządzeniu; uzupełnij raport datą i identyfikatorami wykonań.

Nie uruchamiaj zdalnego wdrożenia z zerowym lokalnym `database_id`. Skrypt generuje `wrangler.production.json` z prawdziwą bazą i subdomeną. Oryginalny PDF pozostaje na urządzeniu, a prywatne API i tekst nie trafiają do cache PWA. Nowe migracje dodawaj po 0003; nie zmieniaj zastosowanych migracji.
