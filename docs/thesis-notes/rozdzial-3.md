# Rozdział 3 — Projekt (notatki)

## 3.x Projekt uwierzytelniania i autoryzacji
- Model dwóch tokenów (ADR-004): krótkotrwały access token JWT (15 min) przechowywany w pamięci aplikacji (nie w `localStorage`, co ogranicza skutki XSS) oraz długotrwały refresh token (7 dni) w ciasteczku `httpOnly`.
- Refresh token jest nieprzezroczysty (losowy), a w bazie przechowywany jest tylko jego skrót SHA-256; każde odświeżenie wymienia token na nowy (rotacja). Powiązanie `RefreshToken.replacedById` tworzy łańcuch wymian.
- Atrybuty ciasteczka: `SameSite=Strict` (ochrona przed CSRF; możliwe, bo SPA i API są w tej samej witrynie dzięki ścieżce `/api`), `Secure` w produkcji, `Path=/api/auth` (ciasteczko nie jest wysyłane do pozostałych endpointów) — ADR-012.
- Schemat decyzyjny odświeżania: patrz diagram sekwencji w `docs/ARCHITECTURE.md`; uzasadnienie okna łaski w ADR-013.
- Model danych: diagram ER w `docs/DATABASE.md` (`User`, `RefreshToken`).
- Wybory technologiczne z uzasadnieniem: bcryptjs (brak natywnej kompilacji, ADR-010), jose (ADR-011).
- Zagrożenia i środki zaradcze: kradzież refresh tokena (rotacja + wykrywanie ponownego użycia), zgadywanie haseł (ograniczanie liczby żądań, bcrypt koszt 12), wyliczanie kont (jednakowa odpowiedź logowania, wyrównanie czasu; kompromis przy rejestracji), wyciek bazy (skróty tokenów, hasła w bcrypt), XSS (access token w pamięci, refresh `httpOnly`).
