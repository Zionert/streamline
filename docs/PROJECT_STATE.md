# Stan projektu StreamLine

_Aktualizacja: 2026-11-11_

## W skrócie
M0 (szkielet monorepo) jest zmergowany do `main` (PR #1, commit `fc29bb0`). M1a (uwierzytelnianie po stronie backendu) jest zaimplementowane i zatwierdzone w przeglądzie kodu (2 rundy); zmiany są na gałęzi `feat/m1a-auth-backend` i nie są jeszcze zacommitowane. Frontend nie ma jeszcze logowania (M1b).

## Gotowe
- Dokumentacja stosu, organizacji pracy i decyzji (ADR-001–015).
- M0: monorepo pnpm, API Express 5 z `GET /health`, frontend Vite/React/Tailwind/shadcn, pakiet `shared`, `docker-compose.yml` (PostgreSQL 18), ESLint/Prettier/Husky/lint-staged, Vitest, GitHub Actions CI. `@hello-pangea/dnd` 18.0.1 potwierdzony z React 19.3.1.
- M1a (backend):
  - modele `User`, `RefreshToken` i migracja `20261111010926_auth_users_refresh_tokens` (`docs/DATABASE.md`),
  - `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` (`docs/API.md`),
  - hasła: bcryptjs; access token JWT (jose, HS256, 15 min) w ciele odpowiedzi; refresh token nieprzezroczysty (7 dni), w bazie tylko skrót SHA-256, ciasteczko httpOnly `refresh_token`, rotacja z wykrywaniem ponownego użycia i oknem łaski (ADR-010–013),
  - middleware `requireAuth`, ograniczanie liczby żądań na `/auth/*`, redakcja danych wrażliwych w logach pino,
  - schematy Zod w `packages/shared` (`registerSchema`, `loginSchema`, `emailSchema`, `passwordSchema`, `publicUserSchema`, `authResponseSchema`, `meResponseSchema`),
  - `createApp({ config, logger, db })` z ręcznym wstrzykiwaniem zależności,
  - testy integracyjne Supertest na osobnej bazie `streamline_test` (ADR-015).
- Sprawdzone lokalnie: `lint`, `typecheck`, `test` (shared 28, api 77, web 5).

## W toku
- —

## Kolejne kroki
1. Commit i PR dla M1a (gałąź `feat/m1a-auth-backend`); weryfikacja CI z `DATABASE_URL_TEST`.
2. M1b: frontend uwierzytelniania (strony `/login`, `/register`, `authSlice`, klient axios, trasy chronione).
3. Założenie tablicy GitHub Projects i issues dla M0–M2.

### Uwagi do M1b
- Access token trzymać wyłącznie w pamięci (stan Zustand), nigdy w `localStorage`.
- Interceptor axios: jedno odświeżenie naraz (single-flight) dla równoległych żądań 401.
- Przy odpowiedzi 401 `REFRESH_TOKEN_ROTATED` krótko poczekać i ponowić `/auth/refresh` jeden raz; jeśli znów się nie powiedzie — traktować użytkownika jako wylogowanego.
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
- CI nie było jeszcze uruchomione na GitHub; sprawdzić tagi akcji (`checkout@v7`, `pnpm/action-setup@v6`, `setup-node@v7`) oraz działanie `DATABASE_URL_TEST` z usługą PostgreSQL.
- `@hello-pangea/dnd`: ostatnie wydanie luty 2025 — dnd-kit jako plan awaryjny.
