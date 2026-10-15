# Backlog i bezpieczna kontynuacja

Poniższa lista nie jest raportem ukończonych funkcji. Stan końcowych testów i wdrożenia należy odczytać z `TEST_REPORT.md`, `DEVELOPMENT_LOG.md` i README.

## P0 — konieczne do prywatnego użycia

- Zweryfikować migrację D1 lokalnie i na środowisku docelowym.
- Uruchomić chronione CRUD-y przedmiotów, zadań, podzadań, wydarzeń, planu i preferencji.
- Zweryfikować OAuth i ponowne logowanie na faktycznej domenie, kontrolę właściciela, CSRF i odrzucenie sesji obcego użytkownika.
- Przetestować PDF.js na tekstowym PDF i jednoznaczne odrzucenie skanu.
- Wykonać wszystkie cztery etapy na rzeczywistym bindingu Workers AI; zapisać logi i checkpointy w D1.
- Sprawdzić niepełne daty, cytaty, duplikaty, błędny JSON modelu, konflikt zajęć i wyczerpanie limitu.
- Sprawdzić korektę propozycji, atomowe zatwierdzanie i idempotencję ponownego zatwierdzenia.
- Przetestować wznowienie po odświeżeniu i wyścig dwóch żądań tego samego etapu.
- Wykonać build, lint, unit/integration oraz E2E Android/desktop z udokumentowanym wynikiem.
- Wdrożyć dopiero po konfiguracji właściciela; nie używać produkcyjnego `DEV_AUTH`.
- Przeprowadzić smoke test produkcyjny: logowanie → przedmiot → zajęcia → zadanie → PDF → AI → akceptacja → ponowne logowanie.

## P1 — jakość codziennego użycia

- Zmierzyć ekstrakcję terminów względem zestawów referencyjnych; odróżnić testy deterministyczne od jakości rzeczywistego LLM.
- Zweryfikować eksport JSON/ICS, poprawność polskich znaków, lokalny czas i zmianę czasu letniego.
- Sprawdzić brak poziomego przepełnienia, obszary dotykowe, focus, stany loading/empty/error i klawiaturę ekranową.
- Potwierdzić instalację PWA na Androidzie przez HTTPS i bezpieczną aktualizację zasobów.
- Zweryfikować, że cache PWA nie przechowuje prywatnych odpowiedzi API.
- Uzupełnić prezentację prawdziwymi logami dopiero po wykonaniu analizy na środowisku docelowym.

## P2 — rozwój po stabilizacji

- OCR jako opcjonalny lokalny moduł z jawnymi limitami urządzenia.
- Rozszerzony model dostępności: przerwy, dni wolne, wyjątki zajęć i dodatkowe strefy czasowe.
- Import USOS/ICS i synchronizacja z zewnętrznym kalendarzem po świadomej autoryzacji.
- Powiadomienia, inteligentne powtórki, import maili; każda integracja z minimalnymi uprawnieniami.
- Kontrolowane zdalne wznowienie workflow bez otwartego klienta, jeśli dostępny bezpłatny mechanizm zapewni wymagane gwarancje.

## Punkt wznowienia

1. Przeczytaj README, `TEST_REPORT.md`, `DEVELOPMENT_LOG.md` i pliki konfiguracji.
2. Nie przenoś produkcyjnych sekretów do repozytorium ani do czatu.
3. Uruchom `npm ci`, lokalne migracje i wymagane sprawdzenia.
4. Sprawdź bieżące identyfikatory modeli i limity w dokumentacji dostawcy; nie opieraj się wyłącznie na danych historycznych.
5. Kontynuuj pierwszą niespełnioną pozycję P0. Każdą blokadę dostępu udokumentuj wraz z dokładnym działaniem właściciela.
