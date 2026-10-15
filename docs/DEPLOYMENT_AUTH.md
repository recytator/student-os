# Wdrożenie i logowanie właściciela

Aplikacja wymaga Cloudflare Workers Free, D1 i Workers AI binding. Nie włączaj planu Workers Paid. Dostępne ustawienia oraz limity należy sprawdzić w `docs/CLOUDFLARE_RESEARCH.md` i aktualnym panelu konta; lokalny test nie potwierdza dostępności modelu na koncie produkcyjnym.

## GitHub OAuth — konfiguracja z telefonu

1. Otwórz <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Nazwa: StudentOS. Homepage URL: rzeczywisty adres Worker `https://studentos.<twoja-subdomena>.workers.dev`.
3. Authorization callback URL: ten sam adres z końcówką `/api/auth/callback`.
4. Zapisz aplikację. Wygeneruj Client secret i wprowadź go wyłącznie w sekrecie Cloudflare `GITHUB_CLIENT_SECRET` albo GitHub Actions Secret. Nie wysyłaj go w czacie i nie commituj.
5. Client ID ustaw jako zmienną `GITHUB_CLIENT_ID`. W `APP_ORIGIN` ustaw dokładny origin aplikacji, bez ścieżki.
6. Swój liczbowy GitHub ID sprawdzisz w `https://api.github.com/users/TWOJ_LOGIN`, pole `id`. Ustaw go jako zmienną `GITHUB_OWNER_ID`. Login tekstowy nie jest identyfikatorem allowlisty.
7. `DEV_AUTH` na produkcji musi być wyłączone. Mechanizm developerski i tak działa wyłącznie dla literalnego hosta `localhost`, `127.0.0.1` lub `[::1]`.

Sekrety Cloudflare można wprowadzić w panelu Workers & Pages → StudentOS → Settings → Variables and Secrets → Add → Secret. Konfiguracja OAuth nie wymaga płatnego API AI ani Cloudflare Access.

## Kontrakt bezpieczeństwa

- Serwer wymienia kod GitHub OAuth na token, weryfikuje `/user` i porównuje **liczbowy GitHub ID** z allowlistą właściciela. Brak konfiguracji blokuje dostęp.
- OAuth używa losowego state, powiązanego z HttpOnly cookie i jednorazowym rekordem D1, oraz PKCE S256. Weryfikator PKCE pozostaje w HttpOnly cookie; D1 przechowuje wyłącznie jego SHA-256. Stan wygasa po 10 minutach.
- Sesja jest losowym bearer tokenem w HttpOnly SameSite=Lax cookie, Secure dla HTTPS. D1 przechowuje jedynie SHA-256 tokenu. Sesja wygasa po siedmiu dniach, wylogowanie usuwa ją z D1.
- Token GitHub jest używany tylko podczas callback; nie jest zapisywany w D1 ani zwracany do frontendu. Zakres `read:user`, bez dostępu do repozytoriów i wiadomości.
- Zmiana allowlisty natychmiast blokuje wcześniejsze sesje innego właściciela.
- Mutacje wymagają ścisłej zgodności nagłówka `Origin` z adresem aplikacji. API nie udostępnia CORS.
- Każdy odczyt/mutacja filtruje `user_id`; dodatkowe triggery D1 blokują relacje między właścicielami.
- Rate limiting jest atomowy i zapisany w D1: 180 odczytów/min i 60 mutacji/min na użytkownika, 10 rozpoczęć logowania/min na adres IP. Limity AI są dodatkowe.
- CSP, blokada osadzania, nosniff, no-referrer i `Cache-Control: no-store` dla API. CSP pozwala na `blob:` tylko dla workerów PDF.js.
- Dane JSON i ICS są pobierane po autoryzacji. Eksport nie zawiera sesji, OAuth state ani sekretów.

## Praca lokalna

`DEV_AUTH=true` w lokalnym `.dev.vars` jest jawnym narzędziem programisty. Otwórz `http://127.0.0.1:8787` po migracjach i zbudowaniu frontendu; lokalny użytkownik jest tworzony w lokalnym D1. Nie jest to logowanie produkcyjne ani test działania GitHub OAuth. Testy HTTP mutacji muszą wysyłać `Origin` zgodny z adresem lokalnej aplikacji. Przy jawnym `DEV_AUTH=true` i wyłącznie dla requestów do literalnego hosta loopback dopuszczony jest również frontend Vite: dokładnie `http://localhost:5173`, `http://127.0.0.1:5173` lub `http://[::1]:5173`. Ten wyjątek umożliwia lokalne proxy do Wranglera na porcie 8787; nie działa na zdalnej domenie ani bez `DEV_AUTH`.

## Test wdrożenia

Po zainstalowaniu sekretów: z anonimowego okna `/api/bootstrap` powinno zwrócić 401; logowanie kontem spoza allowlisty 403; konto właściciela ma otrzymać cookie i możliwość CRUD. Wylogowanie blokuje stare cookie. Sprawdź odświeżenie i drugie urządzenie. Te testy wymagają rzeczywistego wdrożenia i konta GitHub; nie zastępuje ich lokalny tryb developerski.

## Weryfikacja dokumentacji dostawcy (15.10.2026)

Oficjalne źródło GitHub: <https://github.com/github/docs/blob/main/content/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps.md> opisuje `code_challenge`, metodę `S256` i wymianę z `code_verifier`. Flaga dokumentacji <https://github.com/github/docs/blob/main/data/features/pkce_support.yml> włącza funkcję dla `fpt: '*'` i `ghec: '*'`. Źródła pobrano z `raw.githubusercontent.com`; bezpośredni host `docs.github.com` był blokowany przez proxy środowiska. To weryfikacja kontraktu dostawcy, a nie test end-to-end logowania kontem użytkownika.
