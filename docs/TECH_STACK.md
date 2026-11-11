# StreamLine — stos technologiczny

> Wersje: przy inicjalizacji projektu wybieramy **najnowsze stabilne**, a następnie
> blokujemy je w `package.json` / `pnpm-lock.yaml`.
>
> Stan po M0: wersje przypięte dokładnie (bez `^`). Kluczowe: Node 24 (`.nvmrc`), pnpm 10.32.0,
> TypeScript 6.0.3 (ADR-007), React 19.3.1, Vite 8.3.7, Tailwind 4.3.5, Express 5.3.0,
> Prisma 7.10.1 (ADR-008), Zod 4.6.7, Vitest 5.1.0, ESLint 10.14.0, PostgreSQL 18 (`postgres:18-alpine`).
> Stan po M1a: dodano bcryptjs 3.0.3, jose 6.2.17, cookie-parser 1.4.7, express-rate-limit 8.7.4 (ADR-010–015).
> Stan po M1b: dodano w `apps/web` zustand 5.1.0, axios 1.21.1, react-hook-form 7.91.0, @hookform/resolvers 7.0.5 oraz bezpośrednio zod 4.6.7 (wymagany przez typy `zodResolver` przy pnpm). Testy HTTP bez MSW (ADR-019).
> socket.io-client zostanie dodany przy pierwszym użyciu.

## 1. Struktura repozytorium — monorepo (pnpm workspaces)

```
streamline/
├─ apps/
│  ├─ web/        # aplikacja SPA (React + Vite)
│  └─ api/        # serwer Node.js + Express (REST) + Socket.io
├─ packages/
│  └─ shared/     # wspólne typy, schematy Zod, LexoRank, nazwy zdarzeń WebSocket
├─ docs/          # dokumentacja projektu
├─ docker-compose.yml   # PostgreSQL
└─ .github/workflows/ci.yml
```

**Uzasadnienie:** typy DTO i schematy walidacji definiowane są raz w `packages/shared`
i wykorzystywane zarówno przez frontend, jak i backend — ścisłe typowanie TypeScript
po obu stronach aplikacji realizowane jest dosłownie. Turborepo/Nx nie są potrzebne —
wystarczy `pnpm -r`.

## 2. Frontend (`apps/web`)

| Obszar | Technologia | Uwagi |
|---|---|---|
| Język | TypeScript (strict) | `strict: true`, `noUncheckedIndexedAccess: true` |
| Budowanie / serwer deweloperski | **Vite** | aplikacja typu SPA, Next.js zbędny |
| Biblioteka UI | **React** (komponenty funkcyjne + hooki) | |
| Routing | **React Router** | `/login`, `/register`, `/boards`, `/boards/:id` |
| Stan | **Zustand** (slices: `authSlice`, `boardSlice`, `uiSlice`) | jeden magazyn dla danych z REST i WebSocket |
| Klient HTTP | **axios** z interceptorem odświeżania tokena | |
| Drag & drop | **@hello-pangea/dnd** | wersja 18.0.1 zgodna z React 19 (peer deps `^18 || ^19`, test dymny w M0); ostatnie wydanie: luty 2025, dnd-kit pozostaje awaryjną alternatywą |
| Czas rzeczywisty | **socket.io-client** | |
| Style | **Tailwind CSS** + **shadcn/ui** (Radix) | dostępne (a11y) komponenty, lekki zestaw |
| Formularze | **react-hook-form** + Zod resolver | te same schematy co w backendzie |
| Ikony | lucide-react | |

## 3. Backend (`apps/api`)

| Obszar | Technologia | Uwagi |
|---|---|---|
| Środowisko | **Node.js LTS** | |
| Framework | **Express 5** + TypeScript | natywna obsługa błędów z handlerów async |
| Architektura | Controllers → Services → Repositories | |
| Walidacja | **Zod** (schematy z `packages/shared`) | `schema.parse` w kontrolerach (ADR-014) |
| ORM / baza danych | **Prisma** + **PostgreSQL** (Docker) | migracje przez `prisma migrate` |
| Uwierzytelnianie | **JWT** (jose, HS256; access 15 min) + nieprzezroczysty refresh 7 dni + **bcryptjs** | szczegóły niżej; ADR-010–013 |
| Czas rzeczywisty | **Socket.io** (pokoje `board:<id>`, JWT w handshake) | |
| Bezpieczeństwo | helmet, cors (tylko origin frontendu), express-rate-limit na `/auth/*` | |
| Logowanie | pino (+ pino-http) | |
| Uruchamianie dev | tsx watch | |

### Schemat uwierzytelniania
- `POST /auth/login` → `accessToken` w treści odpowiedzi (frontend przechowuje go **w pamięci**,
  nie w localStorage) oraz refresh token w ciasteczku `refresh_token` (**httpOnly, SameSite=Strict, Secure w produkcji**, ścieżka `/api/auth`).
- Refresh token przechowywany w bazie **w postaci skrótu (hash)**, rotowany przy każdym `/auth/refresh`; ponowne użycie jest wykrywane (okno łaski, ADR-013). Endpointy i błędy: `docs/API.md`.
- Socket.io: access token przekazywany w polu `auth` podczas handshake i weryfikowany przez middleware.

## 4. Pakiet wspólny (`packages/shared`)
- Schematy Zod i wyprowadzone z nich typy (`z.infer`) — DTO wszystkich endpointów.
- **LexoRank / indeksowanie frakcyjne — implementacja własna**, z testami jednostkowymi
  i funkcją rebalansowania, gdy klucze stają się zbyt długie.
- Stałe nazw zdarzeń WebSocket (`card:moved`, `column:created`, …) i typy ich danych.

## 5. Model danych (wstępny)
- `User` (id, email, passwordHash, name, avatarUrl) — ✅ M1
- `RefreshToken` (userId, tokenHash, expiresAt, revokedAt, replacedById) — ✅ M1
- `Board` (id, title, ownerId)
- `BoardMember` (boardId, userId, **role: OWNER | ADMIN | MEMBER | VIEWER**) — system uprawnień (`docs/REQUIREMENTS.md`, sekcja 2)
- `Column` (id, boardId, title, **rank**, **category: BACKLOG | TODO | IN_PROGRESS | DONE**, wipLimit?, wipStrict) — kategoria jest podstawą analityki
- `Card` (id, columnId, title, description, **rank**, assigneeId?, dueDate?, priority, createdAt)
- `CardTransition` (id, cardId, boardId, fromColumnId?, toColumnId, movedById, movedAt) — każde przejście karty; źródło danych analityki (ADR-020)
- `Label`, `CardLabel`, `Comment`
- `ActivityLog` (kto, co, kiedy) — historia zmian tablicy
- `AiUsage` (userId, boardId, kind, createdAt) — ewidencja i limit zapytań asystenta AI (opcjonalnie, ADR-021)

## 6. Testowanie

| Poziom | Narzędzie |
|---|---|
| Jednostkowe (LexoRank, serwisy) | **Vitest** |
| Integracyjne API | **Vitest + Supertest** na osobnej testowej bazie |
| Komponenty | **React Testing Library** |
| E2E (logowanie → tablica → drag & drop) | **Playwright** |
| Wydajność | własny benchmark: LexoRank vs. reindeksacja O(n); opóźnienie Socket.io przy wielu klientach |

## 7. Jakość kodu i infrastruktura
- ESLint (flat config) + Prettier; Husky + lint-staged.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- **GitHub Actions CI**: install → lint → typecheck → test (z usługą PostgreSQL).
- `.env.example` w każdej aplikacji; prawdziwe pliki `.env` nigdy nie trafiają do repozytorium.
- Wdrożenie (opcjonalnie): frontend — Vercel/Netlify, API + baza — Render/Railway lub VPS z Dockerem.

## 8. Uzasadnienie wyboru (porównanie alternatyw)

| Wybór | Alternatywy | Dlaczego |
|---|---|---|
| **Prisma** | Drizzle, TypeORM | czytelny, deklaratywny `schema.prisma` (łatwy do przedstawienia jako diagram ER), wbudowane migracje i Prisma Studio, w pełni typowany klient. Drizzle jest lżejszy i bliższy SQL, lecz wymaga więcej ręcznej pracy; TypeORM ma słabsze typowanie. Operacje niestandardowe (np. masowe rebalansowanie rang) realizowane są przez transakcje i `$queryRaw`. |
| **Express** | NestJS, Fastify | minimalny i powszechnie znany; podział na warstwy narzucamy konwencją. NestJS wymusza strukturę, ale wprowadza znaczną złożoność (dekoratory, moduły, DI); Fastify jest szybszy, lecz różnica nie ma znaczenia w skali projektu. |
| **Zustand** | Redux Toolkit, TanStack Query | brak boilerplate'u (reducery, providery); komponenty subskrybują wybrane fragmenty stanu. Jeden magazyn upraszcza nakładanie zdarzeń WebSocket na dane z REST. |
| **@hello-pangea/dnd** | dnd-kit | gotowy model list i kart z płynną animacją — idealny dla tablicy Kanban; dnd-kit jest bardziej elastyczny, ale wymaga więcej implementacji. |
| **Socket.io** | natywny WebSocket, SSE | pokoje, automatyczne ponowne łączenie, fallback transportu, middleware uwierzytelniania. SSE jest jednokierunkowe. |
| **PostgreSQL** | MySQL, MongoDB | relacyjny model danych (tablice → kolumny → karty, członkostwo), transakcje, dojrzałość. |
