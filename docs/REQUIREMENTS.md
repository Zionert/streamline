# StreamLine — wymagania systemu

Dokument definiuje zakres funkcjonalny aplikacji, role i uprawnienia oraz wymagania
niefunkcjonalne. Stanowi podstawę planu prac (`docs/WORKFLOW.md`, sekcja 7) i rozdziału 3.1
pracy dyplomowej.

Priorytety według metody **MoSCoW**: **M** — must (niezbędne), **S** — should (ważne),
**C** — could (opcjonalne, jeśli starczy czasu).

---

## 1. Cel i wyróżnik projektu

StreamLine to lekka aplikacja do zarządzania projektami metodą Kanban (tablice, kolumny,
karty, drag & drop, synchronizacja w czasie rzeczywistym). Od narzędzi klasy Trello odróżnia
ją **wbudowana analityka przepływu pracy**: aplikacja nie tylko wizualizuje pracę, lecz
**mierzy jej przepływ** (czas cyklu, przepustowość, diagram skumulowanego przepływu,
starzejąca się praca) i **prognozuje terminy** metodą Monte Carlo na podstawie
historycznych danych zespołu. W Trello takie funkcje wymagają płatnych rozszerzeń,
a w Jirze są rozbudowane i częściowo płatne.

Uzupełnieniem jest **asystent AI** (funkcja opcjonalna) wspierający pracę z kartami.

---

## 2. Role i uprawnienia

Uprawnienia przypisane są do członkostwa w tablicy (`BoardMember.role`).

| Działanie | OWNER | ADMIN | MEMBER | VIEWER |
|---|:-:|:-:|:-:|:-:|
| Przeglądanie tablicy, kart i analityki | ✅ | ✅ | ✅ | ✅ |
| Karty: tworzenie, edycja, przenoszenie, komentarze | ✅ | ✅ | ✅ | ❌ |
| Kolumny: tworzenie, zmiana nazwy, przenoszenie, usuwanie | ✅ | ✅ | ✅ | ❌ |
| Korzystanie z asystenta AI | ✅ | ✅ | ✅ | ❌ |
| Ustawienia kolumn (limit WIP, kategoria) | ✅ | ✅ | ❌ | ❌ |
| Zarządzanie członkami (dodawanie, zmiana roli, usuwanie) | ✅ | ✅ (z wyjątkiem OWNER) | ❌ | ❌ |
| Zmiana nazwy tablicy | ✅ | ✅ | ❌ | ❌ |
| Usunięcie tablicy, przekazanie własności | ✅ | ❌ | ❌ | ❌ |

Zasady dodatkowe:
- Tablica ma dokładnie jednego właściciela (OWNER). Autor tablicy zostaje jej właścicielem.
- Użytkownik spoza tablicy otrzymuje odpowiedź **404** (nie ujawniamy istnienia tablicy);
  członek bez wymaganej roli — **403**.
- Każdy członek (oprócz OWNER) może opuścić tablicę.

---

## 3. Wymagania funkcjonalne

### 3.1. Uwierzytelnianie (AUTH) — zrealizowane w M1
| ID | Wymaganie | P |
|---|---|:-:|
| WF-AUTH-01 | Rejestracja konta (e-mail, nazwa, hasło) | M |
| WF-AUTH-02 | Logowanie, wylogowanie, utrzymanie sesji po odświeżeniu strony | M |
| WF-AUTH-03 | Chronione trasy frontendu i endpointy API | M |

### 3.2. Tablice i członkowie (BOARD)
| ID | Wymaganie | P |
|---|---|:-:|
| WF-BOARD-01 | Lista tablic użytkownika, tworzenie, zmiana nazwy, usuwanie tablicy | M |
| WF-BOARD-02 | Dodawanie członka po adresie e-mail **zarejestrowanego** użytkownika (bez zaproszeń e-mailowych) | M |
| WF-BOARD-03 | Zmiana roli i usuwanie członka, opuszczenie tablicy | M |
| WF-BOARD-04 | Przekazanie własności tablicy | C |

### 3.3. Kolumny (COL)
| ID | Wymaganie | P |
|---|---|:-:|
| WF-COL-01 | Tworzenie, zmiana nazwy, usuwanie kolumn | M |
| WF-COL-02 | Zmiana kolejności kolumn metodą drag & drop (pole `rank`, LexoRank) | M |
| WF-COL-03 | **Kategoria kolumny**: `BACKLOG`, `TODO`, `IN_PROGRESS`, `DONE` — podstawa obliczeń analityki | M |
| WF-COL-04 | **Limit WIP** kolumny: wyróżnienie wizualne przy przekroczeniu; tryb ścisły blokujący przeniesienie karty ponad limit | S |

### 3.4. Karty (CARD)
| ID | Wymaganie | P |
|---|---|:-:|
| WF-CARD-01 | Tworzenie, edycja, usuwanie kart | M |
| WF-CARD-02 | Przenoszenie kart w obrębie kolumny i między kolumnami (drag & drop, LexoRank, aktualizacja optymistyczna) | M |
| WF-CARD-03 | **Rejestrowanie każdego przejścia karty między kolumnami** (`CardTransition`) od pierwszego przeniesienia | M |
| WF-CARD-04 | Szczegóły karty: opis, osoba przypisana, termin, priorytet | M |
| WF-CARD-05 | Etykiety i komentarze | S |
| WF-CARD-06 | Historia aktywności tablicy (kto, co, kiedy) | S |
| WF-CARD-07 | Wyszukiwanie i filtrowanie kart (tekst, osoba, etykieta) | C |

### 3.5. Czas rzeczywisty (RT)
| ID | Wymaganie | P |
|---|---|:-:|
| WF-RT-01 | Synchronizacja wszystkich zmian tablicy między klientami (Socket.io, pokój `board:<id>`) | M |
| WF-RT-02 | Ponowne łączenie i uzgodnienie stanu po utracie połączenia | M |
| WF-RT-03 | **Obecność**: awatary użytkowników aktualnie przeglądających tablicę | S |
| WF-RT-04 | Wyróżnienie karty przeciąganej w danej chwili przez innego użytkownika | C |

### 3.6. Analityka przepływu (FLOW) — wyróżnik projektu
| ID | Wymaganie | P |
|---|---|:-:|
| WF-FLOW-01 | **Czas realizacji (lead time)** i **czas cyklu (cycle time)** każdej ukończonej karty; wykres punktowy z percentylami 50/85/95 | M |
| WF-FLOW-02 | **Przepustowość (throughput)** — liczba kart ukończonych w dniu/tygodniu, wykres | M |
| WF-FLOW-03 | **Diagram skumulowanego przepływu (CFD)** — liczba kart w każdej kategorii w czasie | M |
| WF-FLOW-04 | **Starzejąca się praca (aging WIP)** — karty w toku dłużej niż 85. percentyl czasu cyklu, wyróżnione na tablicy | S |
| WF-FLOW-05 | **Prognoza Monte Carlo** — „kiedy ukończymy N kart?” oraz „ile kart ukończymy do dnia X?”, z prawdopodobieństwem 50/85/95% | M |
| WF-FLOW-06 | Weryfikacja **prawa Little'a** (średni WIP ≈ przepustowość × średni czas cyklu) na danych tablicy | S |
| WF-FLOW-07 | Wybór zakresu dat analizy; eksport danych do CSV | C |

**Definicje:**
- *Lead time* — od utworzenia karty do jej pierwszego wejścia do kolumny kategorii `DONE`.
- *Cycle time* — od pierwszego wejścia karty do kolumny kategorii `IN_PROGRESS` do wejścia do `DONE`.
- *WIP* — liczba kart w kolumnach kategorii `IN_PROGRESS`.
- Karta przeniesiona z `DONE` z powrotem do pracy traktowana jest jako ponownie otwarta;
  do metryk liczy się ostatnie ukończenie.
- *Monte Carlo* — co najmniej 10 000 symulacji; w każdej losowanie (ze zwracaniem) dziennej
  przepustowości z ostatnich N dni (domyślnie 30) do osiągnięcia celu; wynik jako rozkład
  dat ukończenia i jego percentyle.
- Obliczenia wyłącznie na podstawie `CardTransition` i dat utworzenia kart; logika metryk
  i symulacji jako czyste funkcje w `packages/shared` (testowalne jednostkowo).

### 3.7. Asystent AI (AI) — funkcja opcjonalna
| ID | Wymaganie | P |
|---|---|:-:|
| WF-AI-01 | **Podział zadania na podzadania** — propozycja listy mniejszych kart dla wybranej karty | C |
| WF-AI-02 | **Generowanie kryteriów akceptacji** dla karty | C |
| WF-AI-03 | **Podsumowanie tygodnia** — co zmieniło się na tablicy w ostatnich 7 dniach (na podstawie historii aktywności) | C |

Zasady:
- Asystent **proponuje**, użytkownik **zatwierdza**: żadna zmiana nie jest zapisywana
  bez akceptacji (edycja propozycji przed zapisem).
- Wywołania modelu językowego wyłącznie po stronie serwera; klucz API tylko w `.env`.
- Dostawca modelu za interfejsem `LlmProvider` (adapter) — możliwość zmiany dostawcy;
  w testach dostawca atrapowy (mock), bez połączeń sieciowych.
- Funkcja włączana zmienną `AI_ENABLED`; gdy wyłączona — przyciski asystenta są ukryte,
  a reszta aplikacji działa bez zmian.
- Limit liczby zapytań na użytkownika; ewidencja użycia (`AiUsage`).
- Do modelu przekazywane są wyłącznie dane danej karty/tablicy, bez danych osobowych
  innych użytkowników (np. adresów e-mail).

---

## 4. Wymagania niefunkcjonalne

| ID | Wymaganie |
|---|---|
| WNF-01 Bezpieczeństwo | Hasła haszowane (bcrypt), JWT access w pamięci, refresh w ciasteczku httpOnly z rotacją; autoryzacja każdego endpointu i zdarzenia WebSocket; walidacja danych wejściowych (Zod); ograniczanie liczby żądań |
| WNF-02 Wydajność | Przeniesienie karty: O(1) zapisów w bazie (LexoRank); propagacja zmiany do innych klientów < 200 ms (p95, sieć lokalna); analityka tablicy z 1000 kart < 1 s |
| WNF-03 Niezawodność | Jedno źródło prawdy (REST + baza), aktualizacje optymistyczne z wycofaniem przy błędzie, uzgodnienie stanu po ponownym połączeniu |
| WNF-04 Użyteczność | Interfejs responsywny (od 375 px), obsługa klawiatury w kluczowych akcjach, komunikaty błędów zrozumiałe dla użytkownika |
| WNF-05 Dostępność | Komponenty zgodne z WAI-ARIA (Radix/shadcn), kontrast zgodny z WCAG AA |
| WNF-06 Jakość | TypeScript strict, testy jednostkowe, integracyjne i E2E, CI na każdy pull request |
| WNF-07 Przenośność | Uruchomienie lokalne jednym zestawem poleceń (Docker dla bazy), konfiguracja przez zmienne środowiskowe |
| WNF-08 Kompatybilność | Aktualne wersje Chrome, Firefox, Edge, Safari |

---

## 5. Poza zakresem

- Zaproszenia wysyłane e-mailem, powiadomienia e-mail.
- Tryb offline i rozwiązywanie konfliktów (CRDT).
- Aplikacje mobilne natywne.
- Integracje z zewnętrznymi systemami (GitHub, Slack itp.).
- Pełna obsługa Scruma (sprinty, story points, burndown) — StreamLine koncentruje się na metodzie Kanban.
