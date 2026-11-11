# Rozdział 4 — Implementacja (notatki)

## 4.x Szkielet projektu (M0)
- Monorepo pnpm (`apps/web`, `apps/api`, `packages/shared`) — jeden pakiet kontraktów (schematy Zod) współdzielony przez frontend i backend (ADR-001).
- Pakiet `shared` jest konsumowany ze źródeł dzięki niestandardowemu warunkowi w polu `exports` (warunek `@streamline/source` wskazuje `src/index.ts`). Skraca to pętlę deweloperską (brak kompilacji pośredniej); `dist/` powstaje tylko dla produkcyjnego buildu API (ADR-005).
- Backend: warstwy Controller → Service → Repository; fabryka `createApp({ config, logger })` oddzielona od `server.ts`, co umożliwia testy Supertest bez nasłuchiwania na porcie. Spójny format błędów `{ error: { code, message } }` zdefiniowany schematem Zod.
- Dostęp do bazy: Prisma 7 z adapterem `@prisma/adapter-pg`, klient generowany do `apps/api/src/generated/prisma` i niewersjonowany (ADR-008).
- Wersje zależności przypięte dokładnie; TypeScript 6.0.3 ze względu na ograniczenie `typescript-eslint` (ADR-007).
- Weryfikacja `@hello-pangea/dnd` 18.0.1 z React 19.3.1: test dymny `DragDropContext`/`Droppable`/`Draggable` bez błędów w konsoli (ADR-009).

## 4.x Uwierzytelnianie (M1a)
- Modele `User` i `RefreshToken` (Prisma), migracja `20261111010926_auth_users_refresh_tokens`. E-mail zapisywany znormalizowany (przycięty, małe litery), unikalny.
- Hasła: `bcryptjs` 3.0.3, koszt 12 (w produkcji minimum 12); wejście ograniczone do 72 bajtów UTF-8, ponieważ bcrypt obcina dłuższe hasła (ADR-010).
- Access token: JWT HS256 (`jose`), 15 minut, claimy `sub`, `iat`, `exp`; weryfikacja z listą dozwolonych algorytmów (ADR-011):
```ts
jwtVerify(token, secret, { algorithms: ['HS256'], requiredClaims: ['sub', 'exp'] })
```
- Refresh token: 32 losowe bajty (`randomBytes`, base64url), 7 dni; w bazie wyłącznie skrót SHA-256, więc wyciek bazy nie ujawnia użytecznych tokenów. Przekazywany w ciasteczku `refresh_token` (`httpOnly`, `SameSite=Strict`, `Secure` w produkcji, `Path=/api/auth`) — ADR-012.
- Rotacja: `RefreshTokenRepository.rotate` w jednej transakcji unieważnia stary token (`updateMany` z warunkiem `revokedAt: null`) i tworzy nowy; wynik `count === 0` oznacza przegraną równoległą rotację.
- Warstwa API: `createApp({ config, logger, db })` z ręcznym wstrzykiwaniem zależności; walidacja schematami `shared` bezpośrednio w kontrolerach (ADR-014); `requireAuth` ustawia `req.userId`.
- Logi pino: redakcja nagłówków `authorization`, `cookie`, `set-cookie` oraz pól `password` i tokenów.
- Ograniczanie liczby żądań (express-rate-limit): 100 żądań/15 min na wszystkie `/auth/*` oraz 10 nieudanych prób logowania/rejestracji/15 min (`skipSuccessfulRequests`).

## 4.x Wykrywanie ponownego użycia refresh tokena
Rotacja pozwala wykryć kradzież: jeśli ktoś przedstawi token już wymieniony, token mógł zostać skopiowany. Reakcja zależy od czasu i rodzaju unieważnienia:
- token wymieniony w ciągu `REFRESH_REUSE_GRACE_SECONDS` (domyślnie 30 s) albo przegrany wyścig rotacji — odpowiedź 401 `REFRESH_TOKEN_ROTATED`; nie unieważnia się innych tokenów, ciasteczko zostaje (zwycięska odpowiedź ustawiła już nowe). Obsługuje to uzasadniony przypadek wielu kart przeglądarki odświeżających sesję jednocześnie;
- ponowne użycie po oknie lub tokena unieważnionego wylogowaniem — unieważnienie wszystkich tokenów użytkownika (`revokeAllForUser`), 401 `UNAUTHORIZED`, usunięcie ciasteczka, wpis ostrzegawczy w logu.

Rozróżnienie opiera się na polach `revokedAt` i `replacedById` (ADR-013). Kompromis do omówienia w pracy: jeśli atakujący odświeży skradziony token jako pierwszy, a klient użyje starego tokena w oknie łaski, wykrycie kradzieży jest opóźnione do kolejnego użycia po oknie; okno 0 s daje tryb ścisły kosztem fałszywych alarmów.

## 4.x Wnioski dotyczące bezpieczeństwa (kompromisy)
- **Wyliczanie kont:** logowanie zwraca identyczną odpowiedź 401 dla nieznanego e-maila i błędnego hasła, a dla nieistniejącego konta wykonywane jest porównanie z atrapą hasha (wyrównanie czasu, ochrona przed atakiem czasowym). Natomiast `409 CONFLICT` przy rejestracji ujawnia istnienie konta; zaakceptowano to ze względu na użyteczność formularza i ograniczenie limitem nieudanych prób (10/15 min).
- **Polityka haseł:** schemat logowania nie sprawdza minimalnej długości, aby nie ujawniać polityki.
- **Ograniczenia znane:** licznik limitów w pamięci procesu, brak `trust proxy`, brak `iss`/`aud` w JWT, brak czyszczenia wygasłych tokenów (`docs/PROJECT_STATE.md`).
- Odpowiedzi z tokenami mają `Cache-Control: no-store`.

## 4.x Uwierzytelnianie we frontendzie (M1b)
- Stos: Zustand 5.1.0, axios 1.21.1, react-hook-form 7.91.0 z `@hookform/resolvers` 7.0.5, shadcn/ui.
- `createApiClient` jest fabryką z wstrzykiwanymi zależnościami (`adapter`, `sleep`, `rotatedRetryDelayMs`), co umożliwia deterministyczne testy. Jedno wspólne odświeżenie realizuje współdzielona obietnica `refreshInFlight`; limit jednego powtórzenia żądania zapewnia znacznik `authRetried`.
- Odporność na wyścigi: `sessionEpoch` (zwiększany w `clearSession`) pozwala odrzucić nieaktualny wynik odświeżenia; `logout` oczekuje na `waitForPendingRefresh`. Błędy sieci, 5xx i 429 nie kończą sesji, w odróżnieniu od 401 lub niepoprawnej odpowiedzi.
- Przywracanie sesji: `restoreSession` działa tylko dla stanu `idle` i natychmiast przechodzi w `loading`, więc podwójne wywołanie efektu w StrictMode nie powoduje drugiej rotacji tokena.
- Obsługa błędów formularzy: komunikaty dla 401, 409, 400 (tekst serwera), 429, błędu sieci i ogólnego; pola z `aria-invalid` i `aria-describedby`.
- Znane ograniczenia: patrz „Znane problemy” w `docs/PROJECT_STATE.md` (m.in. odświeżenie w trakcie wylogowania, brak podziału kodu — fragment 537 kB).
