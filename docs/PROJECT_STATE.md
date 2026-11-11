# Stan projektu StreamLine

_Aktualizacja: 2026-11-11_

## W skrócie
M0 (szkielet monorepo) i M1a (uwierzytelnianie backendu) są zmergowane do `main` (PR #1, commit `fc29bb0`; PR #2, merge `fc59c7e`, commit `e741512`). M1b (uwierzytelnianie we frontendzie) jest zaimplementowane i zatwierdzone w przeglądzie kodu (2 rundy); zmiany są na gałęzi `feat/m1b-auth-frontend` i nie są jeszcze zacommitowane.

## Gotowe
- Dokumentacja stosu, organizacji pracy i decyzji (ADR-001–019).
- M0: monorepo pnpm, API Express 5 z `GET /health`, frontend Vite/React/Tailwind/shadcn, pakiet `shared`, `docker-compose.yml` (PostgreSQL 18), ESLint/Prettier/Husky/lint-staged, Vitest, GitHub Actions CI. `@hello-pangea/dnd` 18.0.1 potwierdzony z React 19.3.1.
- M1a (backend):
  - modele `User`, `RefreshToken` i migracja `20261111010926_auth_users_refresh_tokens` (`docs/DATABASE.md`),
  - `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` (`docs/API.md`),
  - hasła: bcryptjs; access token JWT (jose, HS256, 15 min) w ciele odpowiedzi; refresh token nieprzezroczysty (7 dni), w bazie tylko skrót SHA-256, ciasteczko httpOnly `refresh_token`, rotacja z wykrywaniem ponownego użycia i oknem łaski (ADR-010–013),
  - middleware `requireAuth`, ograniczanie liczby żądań na `/auth/*`, redakcja danych wrażliwych w logach pino,
  - schematy Zod w `packages/shared` (`registerSchema`, `loginSchema`, `emailSchema`, `passwordSchema`, `publicUserSchema`, `authResponseSchema`, `meResponseSchema`),
  - `createApp({ config, logger, db })` z ręcznym wstrzykiwaniem zależności,
  - testy integracyjne Supertest na osobnej bazie `streamline_test` (ADR-015).
- M1b (frontend, `apps/web`):
  - `authSlice` (Zustand, `src/stores/auth.ts`): `user`, `accessToken` (tylko w pamięci), `status`, `sessionEpoch`,
  - klient axios (`src/lib/api.ts`): nagłówek Bearer, odświeżanie po 401 (single-flight), jedno opóźnione ponowienie po `REFRESH_TOKEN_ROTATED`, wylogowanie przy ostatecznej porażce (ADR-016, ADR-017),
  - strony `/login` i `/register` (react-hook-form + `zodResolver` ze schematami `loginSchema`/`registerSchema` z `shared`, komponenty shadcn/ui),
  - `ProtectedRoute` (przekierowanie do `/login` ze stanem `from`), `GuestRoute`, `AuthBootstrap` (przywracanie sesji przez `/auth/refresh`, odporne na StrictMode — ADR-018), przycisk „Log out” w `AppLayout`,
  - testy RTL z ręcznym adapterem axios zamiast MSW (ADR-019).
- Sprawdzone lokalnie: `lint`, `typecheck`, `test` (shared 28, api 77, web 77), `format:check`, `build` web (ostrzeżenie: jeden fragment 537 kB).

## W toku
- —

## Kolejne kroki
Zakres i priorytety: `docs/REQUIREMENTS.md`; plan: `docs/WORKFLOW.md`, sekcja 7.
1. **M2a** — własna implementacja LexoRank w `packages/shared` + benchmark (podstawa kolejności kolumn i kart).
2. **M2b** — tablice, członkowie i role zgodnie z macierzą uprawnień (`REQUIREMENTS.md`, sekcja 2).
3. **M2c** — kolumny z kategorią (`BACKLOG`/`TODO`/`IN_PROGRESS`/`DONE`) i limitem WIP.
4. **M2d** — frontend tablic i kolumn.
5. Od M3 każde przeniesienie karty zapisuje `CardTransition` (ADR-020) — warunek analityki przepływu (M6).

### Uwagi dla kolejnych etapów
- Żądania chronione wykonywać przez instancję `api` z `apps/web/src/lib/api.ts` (obsługuje Bearer i odświeżanie); żądań do `/auth/*` nie opakowywać własnym odświeżaniem.
- Przeglądarka wywołuje `/api/auth/*` (proxy Vite); ciasteczko ma `Path=/api/auth`.

## Uruchamianie
1. Wymagane: Node 24 (`.nvmrc`), pnpm 10.32.0, Docker.
2. `pnpm install` (generuje klienta Prisma w `postinstall`).
3. Skopiować `.env.example` do `.env` (root, dla compose), `apps/api/.env.example` do `apps/api/.env`, `apps/web/.env.example` do `apps/web/.env`.
4. W `apps/api/.env` ustawić `JWT_ACCESS_SECRET` (wymagany, min. 32 znaki; API nie wystartuje bez niego). Przykład: `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
5. `pnpm db:up` (PostgreSQL w Dockerze).
6. `pnpm --filter @streamline/api db:migrate` — stosuje migracje (istnieje już `20261111010926_auth_users_refresh_tokens`).
7. `pnpm dev` — API na `:4000`, web na `:5173` (proxy `/api` do API).

Kontrole: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm format:check`, `pnpm build`. Testy API wymagają działającej bazy (`pnpm db:up`); baza `streamline_test` jest tworzona i migrowana automatycznie.

Zmienne środowiskowe uwierzytelniania (`apps/api/.env.example`): `JWT_ACCESS_SECRET`, `ACCESS_TOKEN_TTL_SECONDS` (900), `REFRESH_TOKEN_TTL_SECONDS` (604800), `REFRESH_REUSE_GRACE_SECONDS` (30), `REFRESH_COOKIE_PATH` (`/api/auth`), `BCRYPT_COST` (12), `AUTH_RATE_LIMIT_WINDOW_MS` (900000), `AUTH_RATE_LIMIT_MAX` (100), `AUTH_CREDENTIALS_RATE_LIMIT_MAX` (10), opcjonalnie `DATABASE_URL_TEST`.

## Znane problemy / dług techniczny
- Frontend: odświeżenie może rozpocząć się w trakcie `POST /auth/logout` (równoległe 401 w ciągu ok. 50 ms) i zrotować ciasteczko, zanim wylogowanie je unieważni; możliwe wzmocnienie: flaga „wylogowywanie” powodująca odrzucenie `refreshSession`.
- Frontend: `login`/`register` nie zwiększają `sessionEpoch` — odświeżenie w toku podczas logowania mogłoby nadpisać lub wyczyścić nową sesję (w obecnym UI nieosiągalne).
- Kody błędów (np. `REFRESH_TOKEN_ROTATED`) są zduplikowane w `apps/api` i `apps/web` — przenieść do `packages/shared`.
- Brak podziału kodu (jeden fragment 537 kB) — leniwe ładowanie tras w późniejszym etapie.
- Podwójna nawigacja po zalogowaniu/wylogowaniu (nieszkodliwa).
- Nazwy `WS_EVENTS` są robocze — do zatwierdzenia z funkcjonalnościami.
- `error-handler` mapuje wszystkie błędy 4xx parsera ciała na `BAD_REQUEST`; brak zabezpieczenia `headersSent`.
- Krok `prisma generate` w CI jest zbędny (robi to `postinstall`).
- Pliki w korzeniu (np. `eslint.config.js`) nie są objęte `pnpm -r lint`.
- TypeScript 6.0.3 — przejście na TS 7 po wsparciu w `typescript-eslint`.
- Brak ustawienia `trust proxy` — za reverse proxy limit żądań liczyłby adres proxy zamiast klienta.
- Access token bez claimów `iss`/`aud` — dodać przed uwierzytelnianiem Socket.io.
- Wygasłe i unieważnione wiersze `RefreshToken` nigdy nie są usuwane.
- `409 CONFLICT` przy rejestracji ujawnia istnienie konta (świadomy kompromis, ograniczony limitem żądań).
- Licznik ograniczania żądań jest w pamięci procesu (jedna instancja); okno łaski rotacji używa zegara aplikacji (również założenie jednej instancji).
- Okno łaski opóźnia wykrycie kradzieży, gdy atakujący odświeży token przed klientem (ADR-013).

## Przeszkody / otwarte pytania
- Nie potwierdzono przebiegu CI na GitHub (w tym `DATABASE_URL_TEST` z usługą PostgreSQL); sprawdzić tagi akcji (`checkout@v7`, `pnpm/action-setup@v6`, `setup-node@v7`) oraz działanie `DATABASE_URL_TEST` z usługą PostgreSQL.
- `@hello-pangea/dnd`: ostatnie wydanie luty 2025 — dnd-kit jako plan awaryjny.
