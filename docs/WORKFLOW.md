# StreamLine — organizacja pracy zespołu

Dokument opisuje, jak zespół dwuosobowy (Nazar Bulyha, Andrii Shkraiev) planuje zadania,
pracuje z repozytorium Git i przekazuje sobie pracę.

---

## 1. Model pracy: Kanban + krótkie iteracje

W zespole dwuosobowym formalne ceremonie Scruma są zbędne. Stosujemy **Kanban
z dwutygodniowymi iteracjami (kamieniami milowymi)**:

- **Tablica zadań:** GitHub Projects (widok Board) z kolumnami
  `Backlog → To Do → In Progress (WIP ≤ 2 na osobę) → Review → Done`.
- **Zadanie = GitHub Issue** z numerem (`#12`), etykietami (`frontend`, `backend`, `shared`,
  `bug`, `docs`, `thesis`) i przypisanym kamieniem milowym.
- Każde zadanie zawiera **kryteria akceptacji** w opisie.
- **Cotygodniowe spotkanie (ok. 20 min):** co zrobiono, co dalej, przeszkody.
  Krótkie podsumowanie trafia do `docs/WORKLOG.md`.
- **Dogfooding:** gdy StreamLine obsłuży tablice i karty (M3), przenosimy własne zadania
  do aplikacji — materiał do oceny użyteczności (rozdz. 5.4).

### Definition of Done
- [ ] Kod + testy; `pnpm lint && pnpm typecheck && pnpm test` przechodzą
- [ ] Przegląd kodu wykonany, uwagi krytyczne rozwiązane
- [ ] Dokumentacja w `docs/` zaktualizowana
- [ ] Pull request zatwierdzony przez drugiego członka zespołu i scalony
- [ ] Jeśli zadanie jest istotne dla pracy dyplomowej — notatka w `docs/thesis-notes/`

---

## 2. Podział ról

Obaj członkowie zespołu pracują w pełnym zakresie (frontend + backend).

- **Etap początkowy (M0–M1): Nazar** — szkielet monorepo i uwierzytelnianie. Na tym etapie
  powstają wzorce (struktura modułów, obsługa błędów, testy), na których opiera się dalsza praca.
- **Od M2: podział według funkcjonalności (pionowo)** — każda osoba realizuje zadanie w całości:
  schemat bazy → API → interfejs. Przykład: Nazar — tablice i kolumny, Andrii — karty i drag & drop.
- **Najpierw kontrakt:** przed pracą równoległą uzgadniamy schemat Zod i typ w `packages/shared`
  oraz wpis w `docs/API.md`. Zmiana kontraktu = osobny, mały PR zatwierdzany przez drugą osobę.
- Rozdziały pracy dyplomowej dzielimy według zrealizowanych funkcjonalności.

---

## 3. Git

- **GitHub Flow:** gałąź `main` jest zawsze działająca i chroniona (scalanie tylko przez PR,
  zielone CI, 1 zatwierdzenie).
- Gałęzie: `feat/12-board-crud`, `fix/31-card-rank-collision`, `docs/...`, `chore/...`
  (numer = numer issue).
- Commity: Conventional Commits w języku angielskim — `feat(api): add board CRUD endpoints (#12)`.
- PR: małe (najlepiej < 400 linii), opis: co / dlaczego / jak sprawdzić + `Closes #12`.
- Scalanie: **Squash and merge**, po scaleniu gałąź jest usuwana.
- Przed rozpoczęciem pracy: `git checkout main && git pull`, następnie nowa gałąź.

---

## 4. Cykl realizacji zadania

1. Wybór issue z kolumny To Do, przeniesienie do In Progress, przypisanie do siebie.
2. Utworzenie gałęzi z aktualnego `main`.
3. Implementacja wraz z testami.
4. Samodzielny przegląd kodu i uruchomienie wszystkich kontroli.
5. Aktualizacja dokumentacji (`PROJECT_STATE.md`, `WORKLOG.md`, `API.md`, `DATABASE.md` — w zależności od zmian).
6. Ręczne sprawdzenie działania (`pnpm dev`).
7. Commit → push → pull request → przeniesienie issue do Review.
8. Drugi członek zespołu wykonuje przegląd PR i scala zmiany.

---

## 5. Dokumentacja — co gdzie się znajduje

| Plik | Przeznaczenie |
|---|---|
| `docs/PROJECT_STATE.md` | **Główny plik przekazania pracy**: stan, kolejne kroki, uruchamianie |
| `docs/WORKLOG.md` | Dziennik prac (kto, kiedy, co) |
| `docs/CHANGELOG.md` | Zmiany w produkcie |
| `docs/API.md` | Endpointy REST i zdarzenia WebSocket |
| `docs/DATABASE.md` | Model danych, diagram ER, migracje |
| `docs/ARCHITECTURE.md` | Moduły, przepływy danych, diagramy |
| `docs/DECISIONS.md` | ADR — uzasadnienia decyzji architektonicznych |
| `docs/TECH_STACK.md` | Stos technologiczny i jego uzasadnienie |
| `docs/thesis-notes/` | Materiał roboczy do rozdziałów 3–5 pracy dyplomowej |

---

## 6. Przekazywanie pracy

**Osoba kończąca pracę:**
1. Aktualizuje `docs/PROJECT_STATE.md` i dodaje wpis do `docs/WORKLOG.md`.
2. Commituje i wypycha zmiany (w razie potrzeby jako WIP na gałęzi funkcjonalności).
3. Wysyła krótką wiadomość: gałąź, co zrobiono, co dalej, na co uważać.

**Osoba kontynuująca:**
1. `git pull` (oraz `git checkout <gałąź>`, jeśli kontynuuje cudzą gałąź).
2. `pnpm install`; jeśli pojawiły się migracje — `pnpm --filter api prisma migrate dev`.
3. Lektura `docs/PROJECT_STATE.md` i ostatnich wpisów w `docs/WORKLOG.md`.

Zasada: **wszystko, co trzeba wiedzieć, znajduje się w repozytorium**, a nie w rozmowach.

---

## 7. Plan prac (kamienie milowe)

| # | Kamień milowy | Zakres | Rozdziały pracy |
|---|---|---|---|
| M0 | Szkielet | monorepo, PostgreSQL w Dockerze, Prisma, ESLint/Prettier, Husky, CI, „hello world” frontend + API | 4.4 |
| M1 | Uwierzytelnianie | rejestracja, logowanie, JWT access + refresh, chronione trasy, ekrany logowania/rejestracji | 4.2.1, 5.2 |
| M2 | Tablice i kolumny | CRUD tablic i kolumn, członkowie i role (OWNER/ADMIN/MEMBER/VIEWER) | 3.5, 4.2.2 |
| M3 | Karty + DnD + LexoRank | CRUD kart, przeciąganie kart i kolumn, własna implementacja LexoRank z testami | 4.1.2, 4.3.2 |
| M4 | Czas rzeczywisty | Socket.io: JWT w handshake, pokoje tablic, synchronizacja zmian, ponowne łączenie | 4.2.3 |
| M5 | Szczegóły karty | opis, osoba przypisana, etykiety, termin, komentarze, limity WIP, historia aktywności | 3.3 |
| M6 | Testy i pomiary | E2E (Playwright), benchmark LexoRank vs O(n), opóźnienie Socket.io, test użyteczności | 5.1–5.4 |
| M7 | Dopracowanie | UI/UX, responsywność, wdrożenie, README, zrzuty ekranu do pracy | 3.6 |

Orientacyjnie 2 tygodnie na kamień milowy (~4 miesiące implementacji), pozostały czas — tekst pracy i rezerwa.
