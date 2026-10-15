# Cloudflare Free — weryfikacja wykonalności

Stan dokumentacji sprawdzony przez Supervisora: **15.10.2026**. Źródłem są oficjalne strony dostawcy. Limity i dostępność modeli mogą się zmienić; przed wdrożeniem należy ponownie sprawdzić plan konta. Poniższe wartości są limitami oferty, nie odczytem zużycia konkretnego konta.

## Ustalenia

| Element            | Ustalenie z dokumentacji                                                                                                     | Konsekwencja dla StudentOS                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Workers Free       | 100 000 żądań dziennie; 10 ms CPU na żądanie; 128 MB pamięci; 3 MB skompresowanego kodu Worker                               | PDF.js działa na urządzeniu. Analiza jest dzielona na krótkie etapy HTTP z checkpointami; wymagany pomiar CPU po wdrożeniu. |
| Workers AI Free    | 10 000 neurons dziennie; po limicie zapytania Free przestają działać                                                         | Nie włączamy Workers Paid ani nadwyżek. Własne limity ograniczają liczbę wywołań; aplikacja zachowuje CRUD po błędzie AI.   |
| D1 Free            | 5 mln wierszy odczytu/dzień; 100 tys. wierszy zapisu/dzień; 5 GB łącznego storage                                            | Indeksy właściciela i relacji; ograniczona wielkość dokumentu i wyników; brak przechowywania binarnych PDF w D1.            |
| Model preferowany  | `@cf/zai-org/glm-4.7-flash` jest w katalogu Workers AI; nie znajduje się na sprawdzonej liście modeli wyłącznie płatnych     | Domyślny model, konfigurowalny przez `AI_MODEL`.                                                                            |
| Model alternatywny | `@cf/google/gemma-4-26b-a4b-it` jest w katalogu Workers AI; nie znajduje się na sprawdzonej liście modeli wyłącznie płatnych | Alternatywa konfiguracyjna; nie automatyczny fallback mnożący wywołania.                                                    |
| Integracja         | Binding Workers AI: `env.AI.run(model, input)`                                                                               | Bez OpenAI SDK, klucza OpenAI i dodatkowej płatnej subskrypcji.                                                             |

Dodatkowo D1 Free dopuszcza 50 zapytań na jedno wywołanie Workera, 100 parametrów wiązanych na pojedyncze zapytanie i 100 KB tekstu SQL. `DB.batch()` nie podnosi limitu liczby zapytań. Upload 100 stron i zatwierdzanie wielu pozycji wymagają grupowania rekordów w zapytania wielowierszowe albo ograniczenia wielkości operacji. Źródło techniczne limitów: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/d1/platform/limits.mdx (weryfikacja Backend Agenta w tej sesji).

Neurons nie są tokenami. Limit wywołań StudentOS nie gwarantuje zmieszczenia się każdej analizy w dziennym limicie neurons, ponieważ koszt zależy od modelu i wejścia. Dostępność katalogowa nie dowodzi dostępności na konkretnym koncie. Potrzebne są autoryzacja Cloudflare oraz rzeczywisty test bindingu.

## Źródła

- Workers AI, ceny, darmowa alokacja i modele wymagające Paid: https://developers.cloudflare.com/workers-ai/platform/pricing/
- GLM: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- Gemma: https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/
- Binding Workers AI: https://developers.cloudflare.com/workers-ai/configuration/bindings/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 batch i transakcje: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch

## Warunki utrzymania 0 PLN

1. Konto pozostaje na odpowiednich planach Free; bez aktywacji Paid i płatnych nadwyżek.
2. Własne budżety wejścia, wyjścia, prób i analiz są egzekwowane po stronie serwera.
3. Wyniki dostawcy `usage`, jeśli wystąpią, są przechowywane jako metryki zwrócone przez model. Brak metryk nie oznacza zerowego zużycia.
4. W aplikacji nie wyświetla się szacunków jako pomiaru konta Cloudflare ani jako faktury.
5. Po wyczerpaniu AI zachowujemy dokument, stan analizy i dostęp do ręcznego zarządzania studiami. Wznowienie następuje świadomie po odnowieniu limitu.
6. Testy lokalne, mocki i build nie potwierdzają limitu CPU produkcyjnego Workera. Mierzymy go w Cloudflare po uzyskaniu autoryzacji.

## Status weryfikacji integracji

Weryfikacja dokumentacji: wykonana. Aktualizacja15.10.2026: wdrożenie Workers Free, zdalne migracjeD1 oraz cztery rzeczywiste wywołania GLM zostały potwierdzone (run38783763164). OAuth skonfigurowany i rozpoczęcie302 sprawdzone (run38784110083). Dokładne Neurons, pełny callback właściciela i produkcyjne CPU nadal wymagają odbioru. Nie zastępujemy tych kroków symulowanymi wynikami.
