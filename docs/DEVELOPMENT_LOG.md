# Dziennik tworzenia StudentOS

Data sesji: **15.10.2026**. To zapis rzeczywistej pracy i wykrytych problemów, bez fikcyjnej historii spotkań. Bieżący checkpoint: [CONTINUATION.md](CONTINUATION.md); wyniki i granice dowodów: [TEST_REPORT.md](TEST_REPORT.md).

## Discovery i rzeczywista delegacja

Supervisor sprawdził repozytorium oraz oficjalne limity Workers Free, D1 i modele Workers AI. Wybrano React/TypeScript, Worker ze Static Assets, D1 i binding AI. Weryfikację źródeł zapisano w [CLOUDFLARE_RESEARCH.md](CLOUDFLARE_RESEARCH.md).

Rzeczywiście uruchomiono agentów Architect, Frontend, Backend, AI, QA i Documentation. Pracowali we wspólnym workspace z podziałem odpowiedzialności opisanym w [AGENTS.md](AGENTS.md). Supervisor integrował moduły i rozstrzygał niezgodności kontraktów.

## Implementacja i poprawki lokalne

Powstały schematy Zod, migracje, API CRUD, OAuth z PKCE i sesją HttpOnly, frontend mobile-first, lokalny parser PDF.js, PWA oraz cztery role AI z checkpointami D1. Rozbieżność między wstępnymi kontraktami agentów usunięto przez import wspólnych schematów snake_case.

Documentation Agent wykrył odczyt `step.status` zamiast `step.state` w logach; Frontend Agent go poprawił. QA zgłosił wylogowanie przez GET, brak nazwy dostępności przy szybkim dodawaniu, błąd proxy CSRF, niezgodność PDF.js 6 i błędy CSS. Poprawiono je i wykonano E2E rzeczywistego interfejsu oraz parsera. Lokalnie potwierdzono 12/12 scenariuszy Playwright; Supervisor dodatkowo przejrzał 21 kombinacji ekranów przy 320, 390 i 1440 px. Nie był to test fizycznego Androida.

Backend wykrył limit D1 Free 50 zapytań na wywołanie Workera. AI Agent zastąpił pojedyncze inserty grupowaniem: 20 stron / 100 parametrów, 9 zadań / 99 parametrów oraz 8 wydarzeń z `task_id` / 96 parametrów. Zachowano atomowość batch. Migracja 0002 wymusza jeden aktywny run dokumentu; 0003 wiąże wydarzenia z zadaniami. Zmiana terminu aktualizuje dzienne wydarzenie i usuwa stare bloki nauki z oznaczeniem potrzeby ponownego planowania. Nie uruchamia automatycznie AI.

Audyt wykrył podatność PDF.js 5; zależność podniesiono do 6.4.299. Zaktualizowano także Vitest do 5.0.4 i overrides `undici` oraz `sharp`. Supervisor potwierdził pełny `npm audit` z 0 zgłoszonych podatności. Nie oznacza to gwarancji braku nieznanych podatności.

## CI i początkowe blokady dostępu

Implementację zapisano w repozytorium `recytator/student-os`. Rzeczywiste CI, obejmujące testy i E2E, przeszło m.in. dla `7c96aa1` w przebiegu [38737400553](https://github.com/recytator/student-os/actions/runs/38737400553). Kolejne rozbudowane testy ujawniły timeout 5000 ms bez błędnej asercji. Zwiększono limit jedynie odpowiednich testów do 30 000 ms, zachowując żądania i sprawdzenia; nie zmieniano limitu CPU aplikacji.

Początkowo brakowało poświadczeń Cloudflare i OAuth. Kontrola Actions [38754614301](https://github.com/recytator/student-os/actions/runs/38754614301) zwróciła uczciwe `blocked`. Po dodaniu sekretów przez właściciela oraz potwierdzeniu Workers Free kontynuowano wdrożenie. Historyczna blokada nie jest już bieżącym stanem projektu.

## Rzeczywiste wdrożenie

Zdalna migracja ujawniła błąd SQL `7500 / incomplete input`. Architect dostosował równoważny zapis triggerów i komentarze, zachowując ograniczenia własności; dodano testy naruszeń. Przebieg [38782784943](https://github.com/recytator/student-os/actions/runs/38782784943) zastosował migracje 0001–0003 i opublikował Worker, lecz natychmiastowy health 404 zatrzymał smoke test.

Dodano ograniczone oczekiwanie na gotowość trasy. [38782990131](https://github.com/recytator/student-os/actions/runs/38782990131), zadanie deploy `116587705205`, potwierdził stronę i health HTTP 200 oraz anonimowe bootstrap/tasks HTTP 401. Aplikacja działa pod **https://studentos.recytator.workers.dev**. Oddzielne nieudane zadanie AI tego samego przebiegu nie unieważnia udanej publikacji.

## Rzeczywisty model: sukcesy i niestabilność

Pierwszy live test nie ukończył DocumentAgent i nie zapisał zaakceptowanych danych; cleanup potwierdzono. AI Agent zweryfikował kontrakt GLM i wyłączył domyślne thinking przez `chat_template_kwargs.enable_thinking=false`, zachowując budżet 1500 tokenów. Dodano diagnostykę kategorii błędów bez publikowania surowych odpowiedzi lub ukrytego rozumowania.

[38783763164](https://github.com/recytator/student-os/actions/runs/38783763164) ukończył cztery role w czterech wywołaniach. Zdalne D1 potwierdziło 4 zadania, 4 wydarzenia i stan `committed` po odświeżeniu; wszystkie 4 odrębne pełne daty były trafne. Nie zatwierdzono bloków nauki. Dowód: [live-exact.json](evidence/2026-10-15-live-exact.json).

Próby `38784110083` i `38785341330` ujawniły niedosłowne cytaty lub błędne identyfikatory ReviewAgent. Nie poluzowano zasad zatwierdzania i nie zastąpiono modelu mockiem. Backend dodał zachowawcze uzgadnianie ID, wersję cache v2, osobne metadane pierwotnego wyniku i rzeczywiste liczniki filtrów planera. Nieznane, pominięte, powtórzone i sprzeczne ID nie uzyskują automatycznej akceptacji.

[38784929126](https://github.com/recytator/student-os/actions/runs/38784929126) ukończył konfliktowy zestaw w 47,451 s. Dwie pełne daty ze stroną i cytatem były poprawne (F1 = 1), lecz odnaleziono 3 z 4 wszystkich obowiązków (recall 0,75; F1 ≈ 0,857). Instrukcję terminu w 2099 r. zignorowano. Dwa proponowane bloki nie przeszły końcowych filtrów. Niczego nie zatwierdzono; cleanup potwierdzono. Dowód: [live-ambiguous.json](evidence/2026-10-15-live-ambiguous.json).

Wszystkie powyższe live testy wykonywały handler na loopback ze zdalnymi bindingami AI i D1. Nie są dowodem całego przepływu przez produkcyjne HTTPS ani produkcyjnego CPU.

## Najnowszy rzeczywisty przebieg z katalogiem źródeł

[Przebieg 38786468483](https://github.com/recytator/student-os/actions/runs/38786468483), zadanie AI `116600079868`, commit `422ee2f`: **SUCCESS**, cztery role i cztery wywołania bez retry, **68,663 s**. Wszystkie obowiązki: TP 5, FP 0, FN 0; pełne daty: TP 4, FP 0, FN 0. W obu pomiarach precision, recall i F1 = 1 według dopasowania daty, strony i cytatu.

Planner zaproponował 6 bloków, po przeglądzie pozostały 4 i wszystkie 4 zapisano. Bezpośredni odczyt D1 potwierdził **4 zadania i 8 wydarzeń: 4 terminy oraz 4 bloki nauki**, 1 zatwierdzony wynik i stan `committed` po odświeżeniu. Cleanup potwierdzono. Dowód: [live-references.json](evidence/2026-10-15-live-references.json).

To pierwszy wskazany tutaj przebieg potwierdzający zapis rzeczywistych bloków nauki. Wcześniejsze przebiegi bez zaakceptowanego planu pozostają opisane oddzielnie. Test nadal używał handlera na loopback i zdalnych bindingów; nie jest pomiarem CPU wdrożonego Workera.

## Odbiór logowania właściciela

Sekrety OAuth bezpiecznie przekazano do Workera. Właściciel otrzymał GitHub 404; pełny URL wykazał nową linię `%0A` na końcu Client ID. Poprawka `d54f502` usuwa otaczające białe znaki z obu wartości przed zapisem. Po wdrożeniu użytkownik rozpoczął świeże logowanie i potwierdził: **„Tak, widzę pulpit”**.

W jego formularzu pole callback jest opisane **Redirect URIs**. To poprawne pole; nie trzeba tworzyć aplikacji OAuth ponownie. Potwierdzenie logowania nie oznacza jeszcze odbioru wszystkich funkcji telefonu, PWA lub synchronizacji między urządzeniami.

## Najnowszy checkpoint i pozostałe prace

Supervisor potwierdził najpierw pełne 112/112 testów po poprawkach ReviewAgent i cache v2, a po integracji katalogu źródeł pełne **120/120 PASS**, 14 plików, 26,92 s, wraz z lintem, buildem i formatem. AI Agent wdrożył katalog dokładnych fragmentów: model wybiera `{ref_id}`, a serwer odtwarza prawdziwą stronę i cytat. Usunięto duplikowanie tekstu stron w transporcie do modelu; limity 64 000 znaków i 1500 tokenów pozostają. Katalog ma 8 nowych testów. Zintegrowany kod `422ee2f` opublikowano na `main` i `deploy/studentos`.

QA przygotował produkcyjny test HTTP CRUD/eksportów i opcjonalnie jednej rzeczywistej analizy. Korzysta on z istniejącego właściciela i sesji administracyjnej na 10 minut; to nie jest dowód OAuth. Obowiązują prawdziwe dzienne limity, bez zerowania `ai_usage`, i sprzątanie wyłącznie oznaczonych rekordów testowych. Testy zabezpieczeń skryptu przeszły 8/8. Commit `fd04ff0` opublikowano na `main` i `qa/production`; zlecono test produkcyjny, który potwierdził CRUD i eksporty, lecz bez wywołania AI z powodu budżetu.

## Rzeczywisty odbiór produkcyjnego HTTP — CRUD

[Przebieg 38787061192](https://github.com/recytator/student-os/actions/runs/38787061192), zadanie `116601663500`, commit `fd04ff0`: **`passed_crud_ai_skipped`**. Wykonano 19 rzeczywistych żądań HTTPS do wdrożonego Workera. Potwierdzono tożsamość istniejącego właściciela, anonimowe 401, utworzenie przedmiotu, zadania, zajęć i wydarzenia, ukończenie zadania, odczyt po odświeżeniu, eksport ICS/JSON oraz unieważnienie tymczasowej sesji po wylogowaniu. Własne rekordy i sesję testową usunięto. Dowód: [production-crud.json](evidence/2026-10-15-production-crud.json).

AI **nie zostało wywołane**: przy ówczesnym limicie 2 analiz dziennie właściciel miał już 2 rezerwacje analiz i 5 wywołań. Test poprawnie zwrócił `skipped_owner_daily_budget`, z 0 własnych wywołań, bez zerowania lub zwrotu `ai_usage`. To sukces produkcyjnego CRUD, nie pełnego przepływu AI. Liczby dotyczą chwili testu i nie opisują bieżącego pozostałego budżetu.

Żądania przechodziły przez rzeczywisty Worker i D1, więc konkretny przetestowany CRUD działał w produkcji. Dokładnego CPU nie zmierzono; test ten nie potwierdza produkcyjnego wykonania AI. Tymczasowa sesja administracyjna nie jest dowodem OAuth, które właściciel odebrał osobno.

Najnowszy rdzeń jest wdrożony. Ówczesne pozostałe zadania obejmowały odczyt wyniku produkcyjnego HTTP; wynik pełnego odbioru opisano na końcu. Do odbioru pozostają: fizyczny Android/PWA, ponowne logowanie z zachowaniem danych, drugie urządzenie i pomiar CPU. Instrukcja kontynuacji jest w [CONTINUATION.md](CONTINUATION.md), a kryteria w [ACCEPTANCE.md](ACCEPTANCE.md).

## Korekta dziennego limitu analiz

Rzeczywiste użycie pokazało, że dwie nieudane próby mogły wyczerpać wszystkie miejsca na nowe analizy mimo niewielkiej liczby wywołań. Supervisor zmienia domyślny limit z 2 na 4 analizy dziennie. Nadal obowiązują 24 wywołania dziennie, 12 na run, jeden retry i 1500 tokenów odpowiedzi; nie zwiększa się maksymalna dobowa liczba wywołań. Nie resetuje się `ai_usage` i nie zwraca wcześniejszych rezerwacji. Test sprawdza dopuszczenie czwartej analizy, odmowę piątej i dalszy ręczny CRUD. Pełny zestaw po zmianie: **128/128 PASS**, 15 plików, 24,18 s; lint i build PASS. Commit `5b0d01c` wdrożono w `38787614257`, zadanie deploy `116603572484` zakończyło się sukcesem. Ponowiony odbiór `38787061192`, próba 2, zakończył się pełnym sukcesem opisanym poniżej.

## Pełny odbiór produkcyjnego HTTPS — AI i plan

[Przebieg 38787061192, próba 2](https://github.com/recytator/student-os/actions/runs/38787061192/attempts/2), zadanie `116604733105`: **PASS**, 36 rzeczywistych żądań HTTPS. Harness `fd04ff0` sprawdzał wdrożony Worker `5b0d01c`. CRUD, świeży odczyt, ICS/JSON, anonimowe 401 i wylogowanie sesji testowej przeszły.

Rzeczywisty GLM ukończył DocumentAgent, DeadlineAgent, PlannerAgent i ReviewAgent. Pierwsza próba DeadlineAgent nie przeszła; ograniczony retry zakończył się poprawnie. Cały run zużył **5 rezerwacji i jeden retry**. Pełne daty ze zgodną stroną i cytatem: **4/4, precision = recall = 1**. Ten pomiar nie ocenia semantyki tytułów ani obowiązków bez daty.

Zatwierdzenie i świeży odczyt potwierdziły **4 zadania i 8 wydarzeń: 4 terminy oraz 4 bloki nauki**. Wszystkie oznaczone rekordy i wyłącznie tymczasową sesję QA usunięto. Zachowano rzeczywiste `ai_usage`: przed testem 2 analizy / 5 wywołań, po teście 3 analizy / 10 wywołań, przy limitach 4/24. Jedna pozostała analiza dotyczy odczytu z **18:45:12,661 UTC, 15.10.2026**, nie bieżącej gwarancji.

Dowód zawiera bezpieczne metadane, rzeczywiste kroki oraz tokeny wejścia/wyjścia zwrócone dla ukończonych odpowiedzi: [production-ai.json](evidence/2026-10-15-production-ai.json). Brak tokenów nieudanej próby nie oznacza zerowego zużycia. Nie zapisano prywatnej treści właściciela, cookie, sekretów ani ukrytego rozumowania.

To potwierdzenie działania przetestowanego przepływu AI w produkcyjnym Workers Free, a nie tylko zdalnych bindingów na loopback. **Dokładnego CPU w ms nie zmierzono** i wynik nie gwarantuje obsługi każdego dużego PDF w limicie CPU. Sesja QA nie jest dowodem OAuth; rzeczywiste logowanie właściciela odebrano osobno.

## 16.10.2026 — zgłoszenie właściciela: błąd źródeł i import semestru

Zrzut właściciela pokazał `SCHEMA / sections[0].sources / too_big` w DocumentAgent. Transport ograniczał liczbę referencji przed ich rozwiązaniem, a prompt nie podawał limitu. Serwer teraz sprawdza każdą referencję, usuwa identyczne cytaty i dzieli duże sekcje na grupy po 20 źródeł, bez utraty cytatów. Nieznane referencje nadal są błędem. Prompt ogranicza rozmiar odpowiedzi, a wersja cache to `v3-source-groups`.

Migracja 0005 pozwala jednokrotnie wznowić najnowszy przebieg dokumentu zatrzymany dokładnie przez ten defekt, zachowując checkpointy, historię, liczbę wywołań i dzienne rezerwacje. Nie tworzy nowej analizy ani nie zatwierdza zadań. Ustawia od nowa ograniczony retry wyłącznie dla tej poprawki; znacznik w kontekście uniemożliwia ponowne odzyskanie tego samego przebiegu.

Właściciel wybrał GL2 i podał początek zajęć 04.10.2026. Migracja 0004 zapisuje na jego istniejącym koncie transkrypcję zdjęcia: 10 przedmiotów oraz 18 pozycji planu GI1/GL2, razem z godzinami, salami, liczbą spotkań i ograniczeniami tygodni. Precyzyjny odczyt siatki: GL2 we wtorek 17:00–19:45, od 10.11; wykład percepcji 17:00–18:30, do 03.11. Nie określono daty końca semestru ani wszystkich tygodni. Plan jest trwałym odniesieniem w Kalendarzu i eksporcie JSON; nie tworzy domniemanych wydarzeń co tydzień, nie trafia do ICS ani nie udaje potwierdzonej zajętości w planerze AI. Pozostałe ręczne zajęcia i wydarzenia zachowują dotychczasową semantykę. Dane innych użytkowników nie są zasilane.

Lokalnie: 132/132 unit/integration PASS; lint, format i build PASS. Test regresji przechodzi z 35 referencjami w jednej sekcji i zachowuje wszystkie źródła. Test migracji potwierdza brak resetu limitów oraz jednokrotność naprawy. Dodatkowy E2E obejmuje trwałość transkrypcji i brak poziomego przewijania na telefonie. Pełne E2E: 14/14 PASS (Chromium 390 px i 1440 px). Próba pakowania Workera `wrangler deploy --dry-run` PASS. Wynik wdrożenia zostanie dopisany po wykonaniu.

Wdrożenie zawiera kontrolę zapisu planu w produkcyjnym D1. Skrypt `verify-document-repair.mjs` kontynuuje co najwyżej ostatnią istniejącą analizę właściciela, jeśli zatrzymała się na dokładnie wskazanym błędzie. Używa krótkiej sesji technicznej, sprząta tylko tę sesję i loguje wyłącznie stany/liczniki. Nie loguje dokumentów ani wyników i nie zatwierdza propozycji. Zużywa rzeczywisty pozostały budżet wywołań; niczego nie refunduje.

Pierwsza publikacja poprawki: `df13335`, [38894310601](https://github.com/recytator/student-os/actions/runs/38894310601). Migracje, publikacja, health, prywatne API i OAuth initiation przeszły. Produkcyjne D1 potwierdziło zapis GI1/GL2, początku 04.10 i 18 pozycji; prywatne HTTPS odczytało plan. Rzeczywisty dokument ukończył naprawiony DocumentAgent, ale DeadlineAgent dwukrotnie przekroczył własny limit źródeł (w jednej próbie również błędne `duplicate_of`). Z tego powodu zadanie weryfikacji było czerwone; nie wolno nazywać tego pełnym sukcesem AI. [CI 38894310514](https://github.com/recytator/student-os/actions/runs/38894310514) zakończyło się sukcesem, 132 testy i 14 E2E.

Odczyt wyłącznie operacyjnych metadanych [38894664194](https://github.com/recytator/student-os/actions/runs/38894664194) potwierdził tę przyczynę, bez ujawniania dokumentu lub odpowiedzi modelu. Kolejna poprawka korzysta z obsługiwanego przez typy Workers AI `response_format: json_schema` dla GLM: schematy powstają ze wspólnych kontraktów Zod i ograniczają generowane źródła do trzech referencji. Walidatory źródeł i dat pozostają aktywne. Migracja 0006 wznawia wyłącznie dopasowany błąd DeadlineAgent od zapisanego checkpointu, jednokrotnie i bez resetowania użycia. Cache v4. Nie zwiększono limitu 1500 tokenów ani dziennego limitu wywołań.

**Wynik końcowy:** `08929ca`, [publikacja 38895068198](https://github.com/recytator/student-os/actions/runs/38895068198), zadanie `116953462441` **SUCCESS**. Wersja Workera `f1584c8b-7d66-4b1b-acd1-6daf1c49a042`. D1 i prywatne HTTPS ponownie potwierdziły plan GI1/GL2 (18 pozycji, początek 04.10). Rzeczywisty dokument właściciela ukończył DeadlineAgent, PlannerAgent i ReviewAgent, osiągając `approval` o 11:40:20 UTC. Licznik przebiegu wzrósł z 5 do 8; obejmuje wcześniejsze nieudane próby. Nie naliczono nowej analizy, nie zwrócono żadnych rezerwacji i nie zatwierdzono propozycji za właściciela. Usunięto tylko sesję techniczną. [CI 38895068172](https://github.com/recytator/student-os/actions/runs/38895068172) **SUCCESS**, 134 testy i 14 E2E. [Bezpieczny dowód operacyjny](evidence/2026-10-16-document-repair.json) nie zawiera identyfikatora, treści dokumentu ani wyników właściciela. Jest to dowód poprawnego wykonania tej rzeczywistej próbki w produkcji, nie gwarancja jakości wszystkich dokumentów ani pomiar CPU. Dodatkowe zadanie publicznego fixture `116954298048` również SUCCESS: cztery rzeczywiste role, cztery wywołania bez retry, 5/5 obowiązków i 4/4 pełnych dat według dopasowania źródła/dat, zapis 4 zadań i 5 bloków nauki w zdalnym D1 oraz cleanup. Ten dodatkowy test wykonywał Worker na loopback ze zdalnymi bindingami; dowód produkcyjnego HTTPS pochodzi z prywatnego dokumentu opisany powyżej. [Publiczny dowód](evidence/2026-10-16-guided-public-ai.json).
