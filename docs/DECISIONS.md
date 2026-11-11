# Decyzje architektoniczne (ADR)

## ADR-001: Monorepo pnpm ze wspólnym pakietem
- **Kontekst:** frontend i backend w TypeScript, wspólne DTO i reguły walidacji.
- **Decyzja:** pnpm workspaces: `apps/web`, `apps/api`, `packages/shared` (schematy Zod, typy, LexoRank, zdarzenia WebSocket).
- **Alternatywy:** dwa osobne repozytoria (duplikacja typów); Turborepo/Nx (nadmierna złożoność dla 2 osób).
- **Konsekwencje:** jeden PR może zmienić kontrakt i obie strony jednocześnie; jedno CI.

## ADR-002: Kolejność elementów przez LexoRank (implementacja własna)
- **Kontekst:** przeniesienie karty przy pozycjach całkowitoliczbowych wymaga aktualizacji O(n) wierszy.
- **Decyzja:** pole `rank` (string); nowy klucz wyznaczany pomiędzy sąsiadami — O(1) zapisów; okresowe rebalansowanie.
- **Alternatywy:** pozycja całkowitoliczbowa; pozycja zmiennoprzecinkowa (utrata precyzji); pakiet npm `fractional-indexing`.
- **Konsekwencje:** kluczowy algorytm pracy (rozdz. 4.1.2, 4.3.2, 5.3); wymaga starannych testów.

## ADR-003: REST dla zmian, Socket.io wyłącznie do rozgłaszania
- **Kontekst:** potrzebna jest zarówno trwałość danych, jak i synchronizacja w czasie rzeczywistym.
- **Decyzja:** wszystkie zmiany przechodzą przez REST (walidacja, uprawnienia, transakcja); po sukcesie serwer emituje zdarzenie do pokoju `board:<id>`.
- **Alternatywy:** zmiany bezpośrednio przez WebSocket (trudniejsza walidacja i obsługa błędów).
- **Konsekwencje:** jedno źródło prawdy, łatwiejsze testowanie; klient inicjujący stosuje aktualizację optymistyczną.

## ADR-004: Access token w pamięci, refresh token w ciasteczku httpOnly
- **Decyzja:** access 15 min (stan Zustand), refresh 7 dni (ciasteczko httpOnly, skrót w bazie, rotacja).
- **Konsekwencje:** ochrona przed kradzieżą tokena przez XSS; wymagany endpoint `/auth/refresh` i interceptor axios.
