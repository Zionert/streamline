# StreamLine

Aplikacja internetowa wspierająca zarządzanie projektami w metodyce Agile — interaktywne
tablice Kanban z obsługą drag & drop i synchronizacją w czasie rzeczywistym.

Projekt realizowany w ramach pracy dyplomowej inżynierskiej
(Akademia im. Jakuba z Paradyża w Gorzowie Wielkopolskim).

**Autorzy:** Nazar Bulyha, Andrii Shkraiev
**Promotor:** dr inż. Magdalena Krakowiak

## Technologie
React · TypeScript · Zustand · Vite · Node.js · Express · Prisma · PostgreSQL · Socket.io

Szczegóły: [docs/TECH_STACK.md](docs/TECH_STACK.md)

## Dokumentacja
- [Stan projektu](docs/PROJECT_STATE.md)
- [Organizacja pracy](docs/WORKFLOW.md)
- [Decyzje architektoniczne](docs/DECISIONS.md)

## Uruchamianie
Wymagania: Node 24, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm db:up
pnpm dev
```

API: http://localhost:4000/health, aplikacja: http://localhost:5173.
