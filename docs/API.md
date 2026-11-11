# API

Stan: M0 — dostępny wyłącznie endpoint kontrolny. Kolejne endpointy dochodzą z funkcjonalnościami.

## Konwencje
- W środowisku deweloperskim serwer Vite przekazuje `/api` do API (`VITE_API_PROXY_TARGET`).
- Limit ciała żądania JSON: 1 MB.
- Walidacja wejścia wyłącznie schematami Zod z `packages/shared`.

### Format błędu
Schemat `errorResponseSchema` (`packages/shared`):
```json
{ "error": { "code": "NOT_FOUND", "message": "..." } }
```
Obiekt `error` może zawierać dodatkowe pola (np. szczegóły walidacji). Obsługa w `apps/api/src/middleware/error-handler.ts`:
- `AppError` (w tym `ValidationError`, `NotFoundError`) — status i kod z błędu,
- `ZodError` — błąd walidacji,
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

## Zdarzenia Socket.io
Brak zaimplementowanych zdarzeń. W `packages/shared` zdefiniowano wstępną stałą `WS_EVENTS` (`board:updated`, `column:created`, `card:moved`) oraz funkcję `boardRoom()` (pokój `board:<id>`). Nazwy są robocze i zostaną zatwierdzone razem z funkcjonalnościami.
