# API

Stan: M1a — `GET /health` oraz uwierzytelnianie (`/auth/*`). Kolejne endpointy dochodzą z funkcjonalnościami.

## Konwencje
- Ścieżki w tym dokumencie są podane względem korzenia API (np. `/auth/login`). Przeglądarka używa prefiksu `/api` (np. `/api/auth/login`) — serwer Vite przekazuje `/api` do API (`VITE_API_PROXY_TARGET`) i usuwa prefiks.
- Uwierzytelnianie: nagłówek `Authorization: Bearer <accessToken>` (access token JWT, 15 min). Refresh token to ciasteczko httpOnly (sekcja „Ciasteczko refresh_token”).
- Limit ciała żądania JSON: 1 MB.
- Walidacja wejścia wyłącznie schematami Zod z `packages/shared`.

### Format błędu
Schemat `errorResponseSchema` (`packages/shared`):
```json
{ "error": { "code": "NOT_FOUND", "message": "..." } }
```
Obiekt `error` może zawierać dodatkowe pola (np. szczegóły walidacji). Obsługa w `apps/api/src/middleware/error-handler.ts`:
- `AppError` (w tym `ValidationError`, `NotFoundError`) — status i kod z błędu,
- `ZodError` — błąd walidacji (400 `VALIDATION_ERROR`),
- błędy parsera ciała żądania 4xx — `BAD_REQUEST`,
- pozostałe — 500 (bez ujawniania szczegółów).

Nieistniejąca ścieżka zwraca 404 w tym samym formacie (`middleware/not-found.ts`).

## REST

### GET /health
- Uprawnienia: brak (publiczny).
- Ciało żądania: brak.
- Odpowiedź 200 (`healthResponseSchema`): `{ "status": "ok" }`
- Nie wykonuje zapytań do bazy danych.
- Przykład: `curl http://localhost:4000/health`

## Uwierzytelnianie (`/auth/*`)

Implementacja: `apps/api/src/routes/auth.routes.ts`, `controllers/auth.controller.ts`, `services/auth.service.ts`. Schematy: `packages/shared/src/schemas/auth.ts`. Odpowiedzi z tokenami mają nagłówek `Cache-Control: no-store`.

### Kody błędów uwierzytelniania
| Status | `error.code` | Kiedy |
|---|---|---|
| 400 | `VALIDATION_ERROR` | nieprawidłowe ciało żądania (schemat Zod) |
| 401 | `UNAUTHORIZED` | brak/nieprawidłowy access token; błędne dane logowania; nieprawidłowy, wygasły lub użyty ponownie refresh token |
| 401 | `REFRESH_TOKEN_ROTATED` | refresh token został wymieniony przed chwilą (patrz `/auth/refresh`) |
| 409 | `CONFLICT` | rejestracja na zajęty adres e-mail |
| 429 | `TOO_MANY_REQUESTS` | przekroczony limit żądań |

### Ograniczanie liczby żądań (express-rate-limit, według IP)
- Wszystkie `/auth/*`: `AUTH_RATE_LIMIT_MAX` (100) żądań na okno `AUTH_RATE_LIMIT_WINDOW_MS` (15 min).
- `POST /auth/login` i `POST /auth/register` (wspólny licznik): `AUTH_CREDENTIALS_RATE_LIMIT_MAX` (10) nieudanych prób na okno; udane żądania nie są liczone (`skipSuccessfulRequests`).
- Po przekroczeniu: 429 `TOO_MANY_REQUESTS`. Licznik jest w pamięci procesu.

### Ciasteczko `refresh_token`
Ustawiane przez `register`, `login`, `refresh`; usuwane przez `logout` i przy odrzuceniu tokena w `refresh`.
- `httpOnly`, `SameSite=Strict`, `Secure` tylko gdy `NODE_ENV=production`,
- `Path` = `REFRESH_COOKIE_PATH` (domyślnie `/api/auth`) — przeglądarka nie wysyła ciasteczka do pozostałych ścieżek API,
- `Max-Age` = `REFRESH_TOKEN_TTL_SECONDS` (7 dni).

### Schemat `AuthResponse` (rejestracja, logowanie, odświeżenie)
```json
{
  "accessToken": "<JWT HS256>",
  "user": { "id": "cm...", "email": "jan@example.com", "name": "Jan", "createdAt": "2026-11-11T10:00:00.000Z" }
}
```
Access token: claimy `sub` (id użytkownika), `iat`, `exp`; brak `iss`/`aud`.

### POST /auth/register
- Uprawnienia: brak. Limity: oba (ogólny + dane logowania).
- Ciało (`registerSchema`): `email` (przycinany, małe litery, poprawny e-mail, maks. 254), `password` (min. 8 znaków, maks. 72 bajty UTF-8), `name` (przycinane, 1–100 znaków).
- Odpowiedź 201: `AuthResponse` + ciasteczko `refresh_token`.
- Błędy: 400, 409 (adres zajęty), 429.
- Przykład:
```bash
curl -i -X POST http://localhost:4000/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"jan@example.com","password":"tajne-haslo-123","name":"Jan"}'
```

### POST /auth/login
- Uprawnienia: brak. Limity: oba.
- Ciało (`loginSchema`): `email` (jak wyżej), `password` (1–72 bajty; minimalna długość nie jest sprawdzana, aby nie ujawniać polityki haseł).
- Odpowiedź 200: `AuthResponse` + ciasteczko `refresh_token`.
- Błędy: 400, 401 (`Invalid email or password` — identyczna odpowiedź dla nieznanego e-maila i błędnego hasła), 429.

### POST /auth/refresh
- Uprawnienia: ciasteczko `refresh_token` (bez ciała żądania). Limit: ogólny.
- Odpowiedź 200: `AuthResponse` + nowe ciasteczko (rotacja: poprzedni token zostaje unieważniony).
- Błędy 401:
  - brak ciasteczka, token nieznany lub wygasły — `UNAUTHORIZED`, ciasteczko usuwane;
  - token unieważniony przez rotację w oknie łaski (`REFRESH_REUSE_GRACE_SECONDS`, domyślnie 30 s) lub przegrany wyścig równoległej rotacji — `REFRESH_TOKEN_ROTATED`; **ciasteczko nie jest usuwane**, nie są unieważniane inne tokeny; klient powinien chwilę poczekać i ponowić odświeżenie (raz);
  - ponowne użycie tokena po oknie łaski albo tokena unieważnionego przez wylogowanie/masowe unieważnienie — `UNAUTHORIZED`; unieważniane są wszystkie refresh tokeny użytkownika, ciasteczko usuwane, zdarzenie logowane (warn).
- `REFRESH_REUSE_GRACE_SECONDS=0` wyłącza okno łaski (tryb ścisły).

### POST /auth/logout
- Uprawnienia: ciasteczko `refresh_token` (opcjonalne). Limit: ogólny.
- Odpowiedź 204 bez ciała; ciasteczko usuwane. Idempotentne — brak lub nieznany token nie powoduje błędu.

### GET /auth/me
- Uprawnienia: access token (`requireAuth`). Limit: ogólny.
- Odpowiedź 200 (`meResponseSchema`): `{ "user": { id, email, name, createdAt } }`.
- Błędy: 401 (brak/nieprawidłowy/wygasły token, użytkownik nie istnieje).
- Przykład: `curl http://localhost:4000/auth/me -H "Authorization: Bearer $TOKEN"`

### Middleware `requireAuth`
`apps/api/src/middleware/require-auth.ts`: wymaga nagłówka `Authorization: Bearer <token>`; weryfikuje podpis (jose, dozwolony tylko algorytm HS256) oraz claimy `sub` i `exp`; ustawia `req.userId`. Każdy błąd daje 401 `UNAUTHORIZED`.

## Zdarzenia Socket.io
Brak zaimplementowanych zdarzeń. W `packages/shared` zdefiniowano wstępną stałą `WS_EVENTS` (`board:updated`, `column:created`, `card:moved`) oraz funkcję `boardRoom()` (pokój `board:<id>`). Nazwy są robocze i zostaną zatwierdzone razem z funkcjonalnościami.
