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

## ADR-010: bcryptjs zamiast bcrypt do haszowania haseł
- **Kontekst:** pakiet `bcrypt` wymaga natywnej kompilacji/prebuildów, co sprawia problemy na Windows z Node 24.
- **Decyzja:** `bcryptjs` 3.0.3 (czysty JavaScript), współczynnik kosztu `BCRYPT_COST` (4–15, domyślnie 12, w produkcji min. 12). Hasła są ograniczone do 72 bajtów UTF-8 w schemacie Zod, bo bcrypt obcina dłuższe dane. Przy logowaniu nieznanego e-maila wykonywane jest porównanie z atrapą hasha (tworzoną przy starcie) — wyrównanie czasu odpowiedzi.
- **Alternatywy:** `bcrypt` (natywny, szybszy); argon2 (nowocześniejszy, również natywny).
- **Konsekwencje:** brak problemów z instalacją; wolniejsze haszowanie niż w wersji natywnej. W testach używany jest niski koszt.

## ADR-011: jose zamiast jsonwebtoken do tokenów dostępu
- **Kontekst:** potrzebna weryfikacja JWT z jawnym ograniczeniem dozwolonych algorytmów.
- **Decyzja:** `jose` 6.2.17, algorytm HS256 (`JWT_ACCESS_SECRET`, min. 32 znaki), weryfikacja z listą dozwolonych algorytmów (`algorithms: ['HS256']`) i wymaganymi claimami `sub`, `exp`. TTL 15 min (`ACCESS_TOKEN_TTL_SECONDS`).
- **Alternatywy:** `jsonwebtoken`; RS256 (zbędny przy jednym serwisie).
- **Konsekwencje:** brak claimów `iss`/`aud` — do dodania przed uwierzytelnianiem Socket.io.

## ADR-012: Atrybuty ciasteczka refresh token
- **Kontekst:** refresh token jest wrażliwszy niż access token (ADR-004); przeglądarka komunikuje się z API przez to samo źródło dzięki proxy `/api`.
- **Decyzja:** ciasteczko `refresh_token`: `httpOnly`, `SameSite=Strict`, `Secure` w produkcji, `Path=/api/auth` (konfigurowalne `REFRESH_COOKIE_PATH`), `Max-Age` 7 dni. Token jest wysyłany tylko do endpointów `/api/auth/*`.
- **Alternatywy:** `SameSite=Lax`; ciasteczko dla ścieżki `/`; refresh token w ciele odpowiedzi.
- **Konsekwencje:** ochrona przed XSS i CSRF; wdrożenie z frontendem i API w różnych witrynach (cross-site) wymagałoby zmiany `SameSite`; `REFRESH_COOKIE_PATH` musi odpowiadać ścieżce widzianej przez przeglądarkę.

## ADR-013: Rotacja refresh tokenów i wykrywanie ponownego użycia z oknem łaski
- **Kontekst:** skradziony refresh token pozwala na długotrwały dostęp; jednocześnie kilka kart przeglądarki może odświeżać sesję równolegle tym samym tokenem.
- **Decyzja:** każde `/auth/refresh` unieważnia stary token i wydaje nowy (transakcja; `updateMany ... WHERE revokedAt IS NULL` rozstrzyga wyścigi). Ponowne użycie unieważnionego tokena:
  - w oknie `REFRESH_REUSE_GRACE_SECONDS` (domyślnie 30 s, 0–300, 0 = tryb ścisły) po rotacji lub przy przegranej równoległej rotacji — 401 `REFRESH_TOKEN_ROTATED`, bez unieważniania pozostałych tokenów, ciasteczko zachowane;
  - po oknie albo dla tokena unieważnionego wylogowaniem/masowo — unieważnienie wszystkich refresh tokenów użytkownika, 401 `UNAUTHORIZED`, usunięcie ciasteczka, wpis w logu.
- **Alternatywy:** brak rotacji; ścisła rotacja bez okna (fałszywe alarmy przy wielu kartach).
- **Konsekwencje:** kompromis — jeśli atakujący odświeży token jako pierwszy, a prawowity klient użyje starego tokena w oknie łaski, wykrycie kradzieży jest opóźnione. Okno liczone zegarem aplikacji (poprawne dla jednej instancji). Klient (M1b) musi ponowić odświeżenie po `REFRESH_TOKEN_ROTATED`.

## ADR-014: Walidacja schematami `shared` bezpośrednio w kontrolerach, ręczne DI
- **Kontekst:** `docs/TECH_STACK.md` zakładał middleware `validate(schema)`.
- **Decyzja:** kontrolery wywołują `schema.parse(req.body)`; `ZodError` jest mapowany na 400 `VALIDATION_ERROR` w `error-handler`. Schematy nadal pochodzą wyłącznie z `packages/shared`. Zależności (konfiguracja, logger, klient bazy) są wstrzykiwane ręcznie przez `createApp({ config, logger, db })`.
- **Alternatywy:** middleware `validate()`; kontener DI.
- **Konsekwencje:** typ wejścia wynika z `parse` bez rzutowania; mniej warstw. Middleware można dodać później, jeśli powtórzenia się nasilą.

## ADR-015: Osobna baza testowa dla testów integracyjnych API
- **Kontekst:** testy Supertest muszą działać na prawdziwym PostgreSQL bez ryzyka skasowania danych deweloperskich.
- **Decyzja:** `globalSetup` Vitest wyznacza adres (`DATABASE_URL_TEST` lub `DATABASE_URL` z `_test` dodanym do nazwy bazy), odmawia pracy, gdy nazwa bazy nie kończy się na `_test`, wykonuje `prisma migrate deploy` (tworzy bazę, jeśli brak), a przed każdym testem `TRUNCATE`. `fileParallelism: false` (wspólna baza). CI ustawia `DATABASE_URL_TEST`.
- **Alternatywy:** mocki repozytoriów (nie sprawdzają transakcji ani ograniczeń); baza w pamięci (inny silnik).
- **Konsekwencje:** testy wymagają działającego PostgreSQL (`pnpm db:up`); są wolniejsze od testów z mockami, ale wykrywają błędy zapytań i wyścigów.

## ADR-016: Access token w pamięci i odświeżanie single-flight z jednym opóźnionym ponowieniem
- **Kontekst:** ADR-004 wymaga trzymania access tokena poza `localStorage`; równoległe żądania 401 nie mogą wywołać wielu rotacji refresh tokena, a serwer zwraca `REFRESH_TOKEN_ROTATED` przy wyścigu (ADR-013).
- **Decyzja:** token tylko w stanie Zustand. Interceptor axios po 401 wykonuje jedno wspólne `POST /auth/refresh` (współdzielona obietnica), po czym powtarza żądanie jeden raz (`authRetried`); jeśli token zmienił się w międzyczasie, żądanie jest powtarzane bez nowego odświeżenia. Przy `REFRESH_TOKEN_ROTATED` klient czeka 400 ms i ponawia odświeżenie jeden raz. Endpointy `/auth/refresh|login|register|logout` oraz żądania z `skipAuthRefresh` nie wyzwalają odświeżania (`/auth/me` tak). Sesja jest czyszczona tylko po 401 lub niepoprawnej odpowiedzi odświeżenia; błędy sieci, 5xx i 429 ją zachowują.
- **Alternatywy:** token w `localStorage`; odświeżanie cykliczne w tle; ponawianie bez limitu.
- **Konsekwencje:** brak tokena w pamięci trwałej (po przeładowaniu strony sesję przywraca `/auth/refresh`); stałe 400 ms jest heurystyką (`DEFAULT_ROTATED_RETRY_DELAY_MS`, wstrzykiwalne w testach).

## ADR-017: Epoka sesji i wylogowanie czekające na odświeżenie
- **Kontekst:** odświeżenie w toku mogłoby po wylogowaniu przywrócić sesję lub unieważnić nowszą (wynik z przeszłości).
- **Decyzja:** `sessionEpoch` rośnie przy `clearSession`; wynik odświeżenia z innej epoki jest odrzucany (`StaleRefreshError`), a nieaktualna porażka nie czyści nowszej sesji. `logout` najpierw czeka na `waitForPendingRefresh`, potem wysyła `POST /auth/logout`, zawsze czyści stan i nigdy nie odrzuca obietnicy.
- **Alternatywy:** anulowanie żądań (`AbortController`); brak ochrony.
- **Konsekwencje:** znane luki (`docs/PROJECT_STATE.md`): odświeżenie może wystartować w trakcie `POST /auth/logout`; `login`/`register` nie zwiększają epoki.

## ADR-018: Przywracanie sesji odporne na StrictMode
- **Kontekst:** w trybie deweloperskim React uruchamia efekty dwukrotnie; dwa `POST /auth/refresh` z tym samym ciasteczkiem dałyby `REFRESH_TOKEN_ROTATED`.
- **Decyzja:** `restoreSession` działa tylko dla `status === 'idle'` i synchronicznie przełącza stan na `loading`, więc drugie wywołanie jest pomijane. `/auth/refresh` zwraca użytkownika, więc `/auth/me` nie jest wywoływane. Wywołuje go `AuthBootstrap` (trasa główna).
- **Alternatywy:** flaga w `useRef`; wyłączenie StrictMode.
- **Konsekwencje:** stan sesji jest źródłem prawdy o tym, czy przywracanie już trwa.

## ADR-019: Testy HTTP z ręcznym adapterem axios zamiast MSW
- **Kontekst:** testy klienta wymagają deterministycznego sterowania odpowiedziami (kolejność, opóźnienia, równoległość 401).
- **Decyzja:** `apps/web/src/test/mockAdapter.ts` implementuje adapter axios i jest wstrzykiwany do `createApiClient({ adapter })`; MSW nie jest używany.
- **Alternatywy:** MSW (dodatkowa zależność i warstwa przechwytywania sieci).
- **Konsekwencje:** testy nie obejmują warstwy XHR/`fetch`; mniej zależności, pełna kontrola nad czasem (`sleep` wstrzykiwany).

## ADR-020: Analityka przepływu na podstawie rejestru przejść kart
- **Kontekst:** wyróżnikiem projektu jest analityka przepływu (lead/cycle time, przepustowość, CFD, aging WIP, prognoza Monte Carlo — `docs/REQUIREMENTS.md`, WF-FLOW). Metryki wymagają pełnej historii ruchu kart, której nie da się odtworzyć wstecz.
- **Decyzja:** od M3 każde przeniesienie karty między kolumnami zapisuje wiersz `CardTransition` w tej samej transakcji co zmianę `columnId`/`rank`. Kolumny mają kategorię (`BACKLOG`, `TODO`, `IN_PROGRESS`, `DONE`), dzięki której metryki nie zależą od nazw kolumn. Obliczenia metryk i symulacja Monte Carlo jako czyste funkcje w `packages/shared`; API dostarcza surowe dane lub zagregowane wyniki.
- **Alternatywy:** wyliczanie z ogólnego `ActivityLog` (słabsza struktura, trudniejsze zapytania); znaczniki czasu na karcie (tracą historię ponownych otwarć); zewnętrzne narzędzie BI (poza zakresem).
- **Konsekwencje:** dodatkowy zapis przy każdym przeniesieniu (akceptowalny koszt); indeksy na `(boardId, movedAt)` i `(cardId, movedAt)`; metryki testowalne jednostkowo na danych syntetycznych.

## ADR-021: Asystent AI jako opcjonalny moduł za adapterem dostawcy
- **Kontekst:** funkcje pomocnicze (podział zadania, kryteria akceptacji, podsumowanie tygodnia — WF-AI) korzystają z zewnętrznego modelu językowego, który jest płatny, niedeterministyczny i może być niedostępny.
- **Decyzja:** moduł po stronie serwera za interfejsem `LlmProvider` (konkretny dostawca wybierany konfiguracją), włączany zmienną `AI_ENABLED`; wyniki są wyłącznie propozycjami zatwierdzanymi przez użytkownika; limit zapytań na użytkownika (`AiUsage`); w testach dostawca atrapowy.
- **Alternatywy:** wywołania z przeglądarki (wyciek klucza API); automatyczne stosowanie wyników (ryzyko błędnych zmian); brak modułu.
- **Konsekwencje:** aplikacja działa w pełni bez AI; zmiana dostawcy nie wpływa na resztę kodu; moduł realizowany dopiero po ukończeniu M0–M6.
