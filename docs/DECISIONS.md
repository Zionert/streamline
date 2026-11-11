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

## ADR-005: Pakiet `shared` udostępniany przez niestandardowy warunek `exports`
- **Kontekst:** `apps/web` i `apps/api` importują `@streamline/shared`; kompilowanie pakietu przed każdym typecheckiem, testem czy startem serwera deweloperskiego spowalnia pracę.
- **Decyzja:** w `packages/shared/package.json` pole `exports` zawiera warunek `@streamline/source` wskazujący na `src/index.ts`. Typecheck, ESLint, Vite, `tsx` (dev) i testy używają źródeł TypeScript; skompilowany `dist/` jest używany tylko przy produkcyjnym budowaniu API (`pnpm -r build` buduje `shared` jako pierwszy).
- **Alternatywy:** zawsze kompilowany `dist/` (konieczny watch/build); aliasy ścieżek w `tsconfig` (duplikacja konfiguracji w każdym narzędziu).
- **Konsekwencje:** brak kroku budowania w pętli deweloperskiej; każde narzędzie musi być skonfigurowane z tym warunkiem.

## ADR-006: Jedna konfiguracja ESLint w katalogu głównym
- **Kontekst:** trzy pakiety o zbliżonych regułach.
- **Decyzja:** jeden plik `eslint.config.js` w korzeniu, z regułami typowanymi (type-checked) z `typescript-eslint`; Prettier uruchamiany jednym przebiegiem z korzenia (`format`, `format:check`; pomija `docs/` i `*.md`). Husky + lint-staged uruchamia lint i formatowanie przy commicie.
- **Alternatywy:** osobna konfiguracja w każdym pakiecie.
- **Konsekwencje:** spójne reguły; pliki w korzeniu (np. `eslint.config.js`) nie są objęte `pnpm -r lint`.

## ADR-007: TypeScript 6.0.3 zamiast 7.x
- **Kontekst:** istnieje TypeScript 7.0.2, ale `typescript-eslint` 8.72.2 wymaga wersji `<6.1`.
- **Decyzja:** przypięcie TypeScript 6.0.3.
- **Alternatywy:** TypeScript 7 bez lintowania typowanego; rezygnacja z reguł type-checked.
- **Konsekwencje:** migracja do TS 7, gdy `typescript-eslint` ją wesprze.

## ADR-008: Prisma 7 z adapterem `@prisma/adapter-pg`, wygenerowany klient poza repozytorium
- **Kontekst:** Prisma 7.10.1 to najnowsza wersja stabilna (8.0 dostępna tylko jako RC); w wersji 7 adres bazy znajduje się w pliku konfiguracyjnym, a połączenie wymaga adaptera sterownika.
- **Decyzja:** `datasource` konfigurowany w `apps/api/prisma.config.ts` (ładuje `.env` przez `process.loadEnvFile`); generator `prisma-client` zapisuje klienta w `apps/api/src/generated/prisma` (w `.gitignore`, generowany w `postinstall` pakietu API); klient tworzony w `repositories/db.ts` (`createDbClient`) z adapterem `@prisma/adapter-pg`, połączenie leniwe.
- **Alternatywy:** Prisma 6 (starszy model konfiguracji); commitowanie wygenerowanego klienta.
- **Konsekwencje:** po `pnpm install` klient jest generowany automatycznie; `/health` nie dotyka bazy.

## ADR-009: Potwierdzenie `@hello-pangea/dnd` z React 19
- **Kontekst:** w M0 należało zweryfikować zgodność biblioteki z najnowszym React.
- **Decyzja:** zostaje `@hello-pangea/dnd` 18.0.1 (peer deps `react ^18 || ^19`); test dymny `DragDropContext`/`Droppable`/`Draggable` przechodzi na React 19.3.1 bez błędów w konsoli.
- **Alternatywy:** dnd-kit.
- **Konsekwencje:** ostatnie wydanie biblioteki pochodzi z lutego 2025 — dnd-kit pozostaje rozwiązaniem awaryjnym.
