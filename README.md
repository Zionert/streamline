# StreamLine

Aplikacja internetowa wspierająca zarządzanie projektami w metodyce Agile — interaktywne
tablice Kanban z obsługą drag & drop, synchronizacją w czasie rzeczywistym oraz
wbudowaną analityką przepływu pracy.

Projekt realizowany w ramach pracy dyplomowej inżynierskiej
(Akademia im. Jakuba z Paradyża w Gorzowie Wielkopolskim).

**Autorzy:** Nazar Bulyha, Andrii Shkraiev
**Promotor:** dr inż. Magdalena Krakowiak

## Funkcjonalności
- Rejestracja i logowanie (JWT z rotacją refresh tokenów)
- Tablice, kolumny i karty; role członków tablicy (OWNER, ADMIN, MEMBER, VIEWER)
- Przeciąganie kart i kolumn (kolejność oparta na algorytmie LexoRank)
- Synchronizacja zmian w czasie rzeczywistym (Socket.io)
- Limity WIP, analityka przepływu (czas cyklu, przepustowość, CFD) i prognoza Monte Carlo

## Technologie
React · TypeScript · Zustand · Vite · Tailwind CSS · Node.js · Express · Prisma · PostgreSQL · Socket.io · Vitest · Playwright

## Uruchamianie
Wymagania: Node 24, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm db:up
pnpm --filter @streamline/api db:migrate
pnpm dev
```

API: http://localhost:4000/health, aplikacja: http://localhost:5173.

## Kontrole jakości
```bash
pnpm lint && pnpm typecheck && pnpm test
```
