# Dziennik prac

Najnowsze wpisy na górze.

## 2026-11-11 — Nazar — Wymagania i rozszerzony plan prac
- Nowy dokument `docs/REQUIREMENTS.md`: macierz uprawnień ról, wymagania funkcjonalne (MoSCoW) i niefunkcjonalne, zakres wyłączony.
- Wyróżnik projektu: analityka przepływu (lead/cycle time, przepustowość, CFD, aging WIP, prognoza Monte Carlo, prawo Little'a) oraz obecność użytkowników w czasie rzeczywistym.
- Opcjonalny asystent AI (podział zadania, kryteria akceptacji, podsumowanie tygodnia) za adapterem dostawcy.
- Model danych: kategoria i limit WIP kolumny, `CardTransition`, `AiUsage`; ADR-020, ADR-021.
- Plan prac rozszerzony do M9 (`docs/WORKFLOW.md`, sekcja 7); M2 podzielony na M2a–M2d.

## 2026-11-11 — Nazar — M1b: uwierzytelnianie (frontend)
- `authSlice` (Zustand) z access tokenem wyłącznie w pamięci; klient axios z interceptorem (401 → `/auth/refresh` → ponowienie, single-flight, jedno opóźnione ponowienie po `REFRESH_TOKEN_ROTATED`, wylogowanie po porażce); `sessionEpoch` odrzuca nieaktualne wyniki odświeżania.
- Strony `/login`, `/register` (react-hook-form + schematy `shared`), `ProtectedRoute`, `GuestRoute`, `AuthBootstrap` (przywracanie sesji, odporne na StrictMode), `AppLayout` z przyciskiem wylogowania, walidacja adresu przekierowania.
- Nowe zależności `apps/web`: zustand, axios, react-hook-form, @hookform/resolvers, zod. Testy z ręcznym adapterem axios (bez MSW). Testy: shared 28, api 77, web 77.
- Dokumentacja: ADR-016–019, ARCHITECTURE, TECH_STACK, PROJECT_STATE (M1a oznaczone jako zmergowane), notatki do rozdziałów 3, 4, 5.
- Przegląd kodu: zatwierdzony po 2 rundach (runda 1: wylogowanie w trakcie odświeżania — naprawione).
- Pliki: `apps/web/src/{stores,lib,features/auth,components/layout,components/ui,test,routes.tsx,pages}`, `apps/web/package.json`, `pnpm-lock.yaml`, `docs/*`.

## 2026-11-11 — Nazar — M1a: uwierzytelnianie (backend)
- Modele `User` i `RefreshToken`, migracja `20261111010926_auth_users_refresh_tokens`.
- Endpointy `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`; bcryptjs, JWT (jose), refresh token z rotacją i wykrywaniem ponownego użycia (okno łaski), `requireAuth`, ograniczanie liczby żądań, redakcja logów.
- `createApp({ config, logger, db })` — ręczne wstrzykiwanie zależności; schematy Zod uwierzytelniania w `packages/shared`.
- Testy integracyjne na osobnej bazie `streamline_test` (globalSetup, TRUNCATE); CI używa `DATABASE_URL_TEST`. Testy: shared 28, api 77, web 5.
- Dokumentacja: ADR-010–015, aktualizacja API/DATABASE/TECH_STACK/PROJECT_STATE (M0 oznaczone jako zmergowane), notatki do rozdziałów 3 i 4.
- Przegląd kodu: zatwierdzony po 2 rundach.
- Pliki: `apps/api/prisma/*`, `apps/api/src/{app,server,config,errors,middleware,controllers,routes,services,repositories,test}`, `packages/shared/src/schemas/auth.ts`, `.github/workflows/ci.yml`, `docs/*`.

## 2026-11-11 — Nazar — M0: szkielet monorepo
- Monorepo pnpm, API Express 5 z `/health`, frontend Vite + React + Tailwind + shadcn/ui, pakiet `shared`.
- Prisma 7 (pusty schemat), `docker-compose.yml`, ESLint/Prettier/Husky, Vitest, GitHub Actions.
- Zweryfikowano `@hello-pangea/dnd` z React 19 (test dymny).
- Przegląd kodu: zatwierdzony w pierwszej rundzie.
- Pliki: `package.json`, `pnpm-workspace.yaml`, `eslint.config.js`, `docker-compose.yml`, `.github/workflows/ci.yml`, `apps/*`, `packages/shared`, `docs/*`.

## 2026-11-11 — Nazar — Przygotowanie projektu
- Dobór i opis stosu technologicznego (`docs/TECH_STACK.md`).
- Opis organizacji pracy zespołu (`docs/WORKFLOW.md`).
- Wstępne decyzje architektoniczne (`docs/DECISIONS.md`).
