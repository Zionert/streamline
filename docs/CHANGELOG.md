# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/).

## [Unreleased]
### Dodano
- Szkielet monorepo pnpm: `apps/web`, `apps/api`, `packages/shared` (M0).
- API: Express 5, endpoint `GET /health`, konfiguracja Zod, logowanie pino, obsługa błędów w jednolitym formacie.
- Pusty schemat Prisma 7 z adapterem `@prisma/adapter-pg` i `docker-compose.yml` z PostgreSQL 18.
- Frontend: Vite, React 19, Tailwind 4, shadcn/ui, strona startowa sprawdzająca `/health`.
- Pakiet `shared`: schematy odpowiedzi, robocza lista zdarzeń WebSocket, `boardRoom()`.
- ESLint, Prettier, Husky + lint-staged, Vitest (testy: shared 5, api 15, web 5).
- GitHub Actions CI.
- Test dymny `@hello-pangea/dnd` z React 19.
