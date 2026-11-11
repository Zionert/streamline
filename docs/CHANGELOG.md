# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/).

## [Unreleased]
### Dodano
- Uwierzytelnianie backendu (M1a): `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`; hasła bcryptjs, access token JWT (15 min), refresh token (7 dni) w ciasteczku httpOnly z rotacją, wykrywaniem ponownego użycia i oknem łaski.
- Modele Prisma `User`, `RefreshToken` i migracja `20261111010926_auth_users_refresh_tokens`.
- Middleware `requireAuth`, ograniczanie liczby żądań na `/auth/*`, redakcja nagłówków i pól wrażliwych w logach.
- Schematy Zod uwierzytelniania w `packages/shared`.
- Zmienne środowiskowe: `JWT_ACCESS_SECRET` (wymagana), `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`, `REFRESH_REUSE_GRACE_SECONDS`, `REFRESH_COOKIE_PATH`, `BCRYPT_COST`, `AUTH_RATE_LIMIT_*`, `DATABASE_URL_TEST`.
- Testy integracyjne Supertest na osobnej bazie `streamline_test` (testy: shared 28, api 77, web 5).
- Szkielet monorepo pnpm: `apps/web`, `apps/api`, `packages/shared` (M0).
- API: Express 5, endpoint `GET /health`, konfiguracja Zod, logowanie pino, obsługa błędów w jednolitym formacie.
- Pusty schemat Prisma 7 z adapterem `@prisma/adapter-pg` i `docker-compose.yml` z PostgreSQL 18.
- Frontend: Vite, React 19, Tailwind 4, shadcn/ui, strona startowa sprawdzająca `/health`.
- Pakiet `shared`: schematy odpowiedzi, robocza lista zdarzeń WebSocket, `boardRoom()`.
- ESLint, Prettier, Husky + lint-staged, Vitest (testy: shared 5, api 15, web 5).
- GitHub Actions CI.
- Test dymny `@hello-pangea/dnd` z React 19.

### Zmieniono
- `createApp` przyjmuje `{ config, logger, db }` — klient bazy jest wstrzykiwany z `server.ts`.
- CI przekazuje `DATABASE_URL_TEST` zamiast `DATABASE_URL`.
