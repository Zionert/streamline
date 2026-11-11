# Baza danych

Stan: M0 — schemat Prisma jest pusty (brak modeli i migracji). Wstępny model docelowy: `docs/TECH_STACK.md`, sekcja 5.

## Diagram ER
Brak modeli — diagram zostanie dodany wraz z pierwszą migracją (M1).

## Konfiguracja
- PostgreSQL 18 uruchamiany przez `docker-compose.yml` (`postgres:18-alpine`); dane dostępowe z root `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`).
- Prisma 7.10.1: adres bazy w `apps/api/prisma.config.ts` (zmienna `DATABASE_URL` z `apps/api/.env`).
- Generator `prisma-client`, wyjście `apps/api/src/generated/prisma` (poza repozytorium; generowany w `postinstall` pakietu API).
- Połączenie przez `@prisma/adapter-pg`; klient tworzony w `apps/api/src/repositories/db.ts` (`createDbClient`), połączenie leniwe.
- Tylko repozytoria korzystają z Prisma.
- CI używa usługi PostgreSQL z bazą `streamline_test`.

## Modele
Brak.

## Migracje
Brak. Polecenie po dodaniu modeli: `pnpm --filter @streamline/api db:migrate`.
