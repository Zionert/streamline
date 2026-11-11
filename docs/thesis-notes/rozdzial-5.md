# Rozdział 5 — Testy (notatki)

## 5.x Stan po M1a
Vitest: `packages/shared` — 28 testów, `apps/api` — 77, `apps/web` — 5 (łącznie 110). Jakość kodu: ESLint z regułami typowanymi, Prettier, hook pre-commit; CI w GitHub Actions.

## 5.x Testy integracyjne API
- Supertest na prawdziwym PostgreSQL, osobna baza `streamline_test` (ADR-015): `globalSetup` stosuje migracje (`prisma migrate deploy`), przed każdym testem tabele są czyszczone (`TRUNCATE`), pliki testowe uruchamiane sekwencyjnie. Zabezpieczenie: odmowa pracy na bazie, której nazwa nie kończy się na `_test`.
- Testy jednostkowe serwisów (`auth.service`, `token.service`), middleware (`require-auth`), konfiguracji i logera (redakcja danych wrażliwych), schematów Zod w `shared`.
- Scenariusze bezpieczeństwa objęte testami: rotacja refresh tokena, ponowne użycie w oknie łaski i po nim, równoległa rotacja, wylogowanie (idempotentne), jednakowa odpowiedź logowania dla nieznanego e-maila i błędnego hasła, limity żądań (429), atrybuty ciasteczka, odrzucanie tokenów z niedozwolonym algorytmem.

## 5.x Stan po M1b i testy frontendu
- Vitest: `packages/shared` — 28 testów, `apps/api` — 77, `apps/web` — 77 (łącznie 182).
- Testy `apps/web`: klient HTTP `api.test` (27: single-flight, ponowienie po `REFRESH_TOKEN_ROTATED`, błędy sieci/5xx/429, odrzucanie nieaktualnych wyników), `session` (6), `authApi` (2), `LoginPage` (7), `RegisterPage` (5), `ProtectedRoute` (9), `AppLayout` (3), `redirect` (10), `stores/auth` (3) oraz istniejące testy strony startowej.
- Podejście: React Testing Library z ręcznym adapterem axios zamiast MSW (ADR-019); czas sterowany przez wstrzykiwany `sleep`.
- Przegląd kodu (2 rundy) wykrył wyścig wylogowania z odświeżeniem w toku; poprawka (`waitForPendingRefresh`, `sessionEpoch`) ma pokrycie testami.
