# Rozdział 4 — Implementacja (notatki)

## 4.x Szkielet projektu (M0)
- Monorepo pnpm (`apps/web`, `apps/api`, `packages/shared`) — jeden pakiet kontraktów (schematy Zod) współdzielony przez frontend i backend (ADR-001).
- Pakiet `shared` jest konsumowany ze źródeł dzięki niestandardowemu warunkowi w polu `exports` (warunek `@streamline/source` wskazuje `src/index.ts`). Skraca to pętlę deweloperską (brak kompilacji pośredniej); `dist/` powstaje tylko dla produkcyjnego buildu API (ADR-005).
- Backend: warstwy Controller → Service → Repository; fabryka `createApp({ config, logger })` oddzielona od `server.ts`, co umożliwia testy Supertest bez nasłuchiwania na porcie. Spójny format błędów `{ error: { code, message } }` zdefiniowany schematem Zod.
- Dostęp do bazy: Prisma 7 z adapterem `@prisma/adapter-pg`, klient generowany do `apps/api/src/generated/prisma` i niewersjonowany (ADR-008).
- Wersje zależności przypięte dokładnie; TypeScript 6.0.3 ze względu na ograniczenie `typescript-eslint` (ADR-007).
- Weryfikacja `@hello-pangea/dnd` 18.0.1 z React 19.3.1: test dymny `DragDropContext`/`Droppable`/`Draggable` bez błędów w konsoli (ADR-009).

## 5.x Testy (stan po M0)
Vitest: `packages/shared` — 5 testów, `apps/api` — 15, `apps/web` — 5 (łącznie 25). Jakość kodu: ESLint z regułami typowanymi, Prettier, hook pre-commit; CI w GitHub Actions.
