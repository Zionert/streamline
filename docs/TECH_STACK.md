# StreamLine — stos technologiczny

> Wersje: przy inicjalizacji projektu wybieramy **najnowsze stabilne**, a następnie
> blokujemy je w `package.json` / `pnpm-lock.yaml`.

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
| Drag & drop | **@hello-pangea/dnd** | do zweryfikowania zgodność z najnowszym React w M0; alternatywa: dnd-kit |
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
| Walidacja | **Zod** (schematy z `packages/shared`) | middleware `validate(schema)` |
| ORM / baza danych | **Prisma** + **PostgreSQL** (Docker) | migracje przez `prisma migrate` |
| Uwierzytelnianie | **JWT** (access 15 min + refresh 7 dni) + **bcrypt** | szczegóły niżej |
| Czas rzeczywisty | **Socket.io** (pokoje `board:<id>`, JWT w handshake) | |
| Bezpieczeństwo | helmet, cors (tylko origin frontendu), express-rate-limit na `/auth/*` | |
| Logowanie | pino (+ pino-http) | |
| Uruchamianie dev | tsx watch | |

### Schemat uwierzytelniania
- `POST /auth/login` → `accessToken` w treści odpowiedzi (frontend przechowuje go **w pamięci**,
  nie w localStorage) oraz `refreshToken` w ciasteczku **httpOnly, Secure, SameSite=Strict**.
- Refresh token przechowywany w bazie **w postaci skrótu (hash)**, rotowany przy każdym `/auth/refresh`.
- Socket.io: access token przekazywany w polu `auth` podczas handshake i weryfikowany przez middleware.

## 4. Pakiet wspólny (`packages/shared`)
- Schematy Zod i wyprowadzone z nich typy (`z.infer`) — DTO wszystkich endpointów.
- **LexoRank / indeksowanie frakcyjne — implementacja własna**, z testami jednostkowymi
  i funkcją rebalansowania, gdy klucze stają się zbyt długie.
- Stałe nazw zdarzeń WebSocket (`card:moved`, `column:created`, …) i typy ich danych.

## 5. Model danych (wstępny)
- `User` (id, email, passwordHash, name, avatarUrl)
- `Board` (id, title, ownerId)
- `BoardMember` (boardId, userId, **role: OWNER | ADMIN | MEMBER | VIEWER**) — system uprawnień
- `Column` (id, boardId, title, **rank**, wipLimit?) — limit WIP zgodny z metodą Kanban
- `Card` (id, columnId, title, description, **rank**, assigneeId?, dueDate?, priority)
- `Label`, `CardLabel`, `Comment`
- `ActivityLog` (kto, co, kiedy) — historia zmian tablicy
- `RefreshToken` (userId, tokenHash, expiresAt, revokedAt)

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
