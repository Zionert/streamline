# Stan projektu StreamLine

_Aktualizacja: 2026-11-11_

## W skrócie
M0 (szkielet monorepo) jest zaimplementowany i zatwierdzony w przeglądzie kodu. Zmiany są na gałęzi `feat/m0-monorepo-skeleton` (jeszcze niezacommitowane). Brak funkcjonalności biznesowych.

## Gotowe
- Dokumentacja stosu, organizacji pracy i decyzji (ADR-001–009).
- M0: monorepo pnpm, API Express 5 z `GET /health`, frontend Vite/React/Tailwind/shadcn, pakiet `shared`, pusty schemat Prisma 7, `docker-compose.yml` (PostgreSQL 18), ESLint/Prettier/Husky/lint-staged, Vitest, GitHub Actions CI.
- Sprawdzone lokalnie: `lint`, `typecheck`, `test` (shared 5, api 15, web 5), `format:check`, `build`.
- `@hello-pangea/dnd` 18.0.1 potwierdzony z React 19.3.1.

## W toku
- —

## Kolejne kroki
1. Commit i PR dla M0; weryfikacja pierwszego przebiegu CI.
2. M1: uwierzytelnianie (Nazar).
3. Założenie tablicy GitHub Projects i issues dla M0–M2.

## Uruchamianie
1. Wymagane: Node 24 (`.nvmrc`), pnpm 10.32.0, Docker.
2. `pnpm install` (generuje klienta Prisma w `postinstall`).
3. Skopiować `.env.example` do `.env` (root, dla compose), `apps/api/.env.example` do `apps/api/.env`, `apps/web/.env.example` do `apps/web/.env`.
4. `pnpm db:up` (PostgreSQL w Dockerze).
5. `pnpm --filter @streamline/api db:migrate` — dopiero gdy pojawią się modele.
6. `pnpm dev` — API na `:4000`, web na `:5173` (proxy `/api` do API).

Kontrole: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm format:check`, `pnpm build`.

## Znane problemy / dług techniczny
- Nazwy `WS_EVENTS` są robocze — do zatwierdzenia z funkcjonalnościami.
- `error-handler` mapuje wszystkie błędy 4xx parsera ciała na `BAD_REQUEST`; brak zabezpieczenia `headersSent`.
- Krok `prisma generate` w CI jest zbędny (robi to `postinstall`).
- Pliki w korzeniu (np. `eslint.config.js`) nie są objęte `pnpm -r lint`.
- Klient bazy powinien być wstrzykiwany do repozytoriów z `server.ts` (obecnie tworzony w `repositories/db.ts`).
- TypeScript 6.0.3 — przejście na TS 7 po wsparciu w `typescript-eslint`.

## Przeszkody / otwarte pytania
- Docker/PostgreSQL nie został zweryfikowany lokalnie (demon wyłączony); `docker compose config` jest poprawne.
- CI nie było jeszcze uruchomione na GitHub; sprawdzić tagi akcji (`checkout@v7`, `pnpm/action-setup@v6`, `setup-node@v7`).
- `@hello-pangea/dnd`: ostatnie wydanie luty 2025 — dnd-kit jako plan awaryjny.
