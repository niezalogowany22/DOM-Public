# Dom — system wyglądu

Cały wygląd aplikacji (styl **Material 3 Expressive**, jasny i ciemny) opiera się na **`tokens.css`**. `styles.css` nie zawiera już żadnych
kolorów wpisanych na sztywno — korzysta tylko ze zmiennych. Zmiana koloru, zaokrąglenia czy
rozmiaru przycisku = jedna linia w `tokens.css`, działa wszędzie (Dom, Liczniki, Grafik, podgląd wyjazdu).

## Styl: Material 3 Expressive

Kolory to **role M3** wyliczone z jednego ziarna (`#2f6f62`, zieleń morska) — palety tonalne
primary / secondary / tertiary / neutral / error. Kształty z rozszerzonej skali M3 Expressive
(do 32 px), font **Roboto Flex** (lokalnie, `roboto-flex-latin*.woff2`, licencja SIL OFL),
ruch „sprężynowy” (krzywe z lekkim przestrzeleniem).

## Trzy warstwy

| Warstwa | Przykład | Kiedy zmieniać |
|---|---|---|
| **Prymitywy** — palety tonalne, skale | `--p-40: #1f6b5c`, `--radius-xl: 24px`, `--space-4` | nowy kolor marki |
| **Role M3 + semantyczne** | `--md-primary-container`, `--color-primary`, `--color-surface` | **tu działa motyw jasny/ciemny** |
| **Komponentowe** | `--btn-radius`, `--card-radius`, `--group-on-bg`, `--fab-bg` | dopasowanie jednego elementu |

Reguła: `styles.css` używa warstw 2 i 3. Prymitywy są tylko w `tokens.css`.

## Motyw

- Domyślnie **jak w telefonie** (`prefers-color-scheme`).
- Więcej → Wygląd: *Jak w telefonie / Jasny / Ciemny* — zapis w `localStorage` (`dom:theme`),
  ustawiany na `<html data-theme>` jeszcze przed załadowaniem stylów (bez mignięcia).
- Kolor paska systemowego (`theme-color`) idzie za motywem.

## Role kolorów

| Rola | Jasny | Ciemny | Do czego |
|---|---|---|---|
| `--md-primary` | `#1f6b5c` | `#8cd5c3` | przyciski główne, FAB, wybrana opcja grupy |
| `--md-primary-container` | `#a8f0de` | `#005144` | karta główna (budżet, raport) |
| `--md-secondary-container` | `#cde8e0` | `#344c45` | przyciski tonalne, wybrany chip, wskaźnik w nawigacji |
| `--md-tertiary-container` | `#c8e6ff` | `#224a62` | kafelek wydatków miesiąca |
| `--md-surface` | `#f5fbf8` | `#0f1513` | tło strony, pola formularzy |
| `--md-surface-container` | `#e9efec` | `#1b211f` | karty, dolny pasek |
| `--md-surface-container-high(est)` | `#e3eae6` / `#dee4e1` | `#252b29` / `#303634` | grupy przycisków, pole kwoty, wyszukiwarka |
| `--md-secondary` | `#4a635c` | `#b1ccc4` | podpis aktywnej zakładki w dolnym pasku |
| `--md-on-surface(-variant)` | `#171d1b` / `#3f4946` | `#dee4e1` / `#bec9c5` | tekst / tekst pomocniczy |
| `--md-outline` | `#6f7976` | `#899390` | obrysy pól i chipów (≥ 3:1) |
| `--md-error`, `--md-warning`, `--md-success` | | | minus/usuń, uwaga, plus |

## Skale (wartości z M3 Expressive)

- **Odstępy** (siatka 4 px): `--space-1` 4 … `--space-6` 24
- **Kształty — 10 stopni M3**: none 0 · `-xs` 4 · `-sm` 8 · `-md` 12 · `-lg` 16 · `-lg-increased` 20 · `-xl` 28 · `-xl-increased` 32 · `-2xl` 48 · `-full`
- **Typografia — role M3** (`--type-*`, tracking `--tracking-*`): body large 16/24 (tekst), body medium 14/20,
  label large 14/20 (przyciski, chipy), label medium 12/16 (dolny pasek), title medium 16/24, title large 22/28,
  headline medium 28/36, display small 36/44, display medium 45/52. Zestaw **emphasized** (`-emph`) = ten sam
  rozmiar, większa grubość — tylko tam, gdzie coś ma przyciągać uwagę (tytuły, wybrane opcje, przyciski główne, kwoty).
- **Ruch** — oficjalne odpowiedniki sprężyn na web: `--spring-fast` 350 ms (kształty, wskaźniki), `--spring-default`
  500 ms (pasek postępu), `--effects-fast/default` 150/200 ms (kolory, przezroczystość — bez odbicia).
- **Warstwa stanu**: hover 8 %, wciśnięcie 10 %, fokus 10 %.

## Komponenty

| Element | Wymiary i kolory (M3) | Interakcja |
|---|---|---|
| **Przycisk** `.btn` | Small: 40 dp, boki 16, pełny róg, tonalny (secondary container), label large | wciśnięty: róg 8 |
| **Główny** `.btn.primary` | filled primary, label large emphasized | jw. |
| **Duży** `.btn.big` | Medium: 56 dp, boki 24, ikona 24, title medium | wciśnięty: róg 12 |
| **Usuń** `.btn.danger` | obrys outline 1 dp, tekst error | |
| **Extended FAB** `.fab` | 56 dp, róg 16, boki 16, ikona 24, primary container, poziom 3 | warstwa stanu |
| **Karta** `.card` | Filled card: róg 12, padding 16, odstęp 8, bez cienia | |
| **Lista** `.card.flush` | segmentowana: grupa 16, wpisy 4, odstęp 2, wpis ≥ 56 dp, avatar 40 | wciśnięty wpis: róg 16 |
| **Chip** `.pill` | Filter chip: 32 dp, róg 8, obrys outline | wybrany: secondary container + ✓ 18 dp |
| **Grupa przycisków** `.subnav`, pigułki `payer/mode/theme/scope` | Connected group: 40 dp, odstęp 2, rogi zewn. pełne, wewn. 8 | wybrany: primary, pigułka; sąsiedzi bez zmian |
| **Dolny pasek** `nav` | Navigation bar: 64 dp, surface container, wskaźnik 56×32 | aktywny: wskaźnik secondary container, podpis secondary, label medium emphasized |
| **Pole** `input, select` | Outlined text field: 56 dp, róg 4, obrys 1 dp | fokus: 2 dp primary |
| **Pole kwoty** `.amountrow` | Filled text field: surface container highest, róg 4 u góry, wskaźnik 1 dp, display small | fokus: wskaźnik 2 dp primary |
| **Wyszukiwarka** `.searchbar` | Search bar: 56 dp, pełny róg | |
| **Pasek postępu** `.pbar` | falowany: grubość 4, amplituda 3, fala 40, przerwa 4, kropka 4 | `.warn` / `.over` |
| **Snackbar** `.toast` | inverse surface, róg 4, ≥ 48 dp, body medium | |
| **Plakietka** `.nbadge` | 16 dp, pełna, error | |

**Decyzje własne (nie z M3):** karta główna budżetu/raportu z mieszanym kształtem (32/32/32/12) jako jedyny moment
„hero”; kolory kafelków Start (tertiary/secondary container); szerokość okna 640 px; kod karty zawsze na białym tle.

## Jak zmienić wygląd

- **Inny kolor marki**: wygeneruj palety tonalne z nowego ziarna (np. Material Theme Builder) i podmień prymitywy `--p-*`, `--s-*`, `--t-*`.
- **Inne zaokrąglenia**: tylko stopnie ze skali M3; element w środku = róg rodzica − padding.
- **Bez sprężyn**: ustaw `--spring-fast` i `--spring-default` na `var(--effects-fast)`.

## Zgodność

Stare nazwy (`--bg`, `--card`, `--accent`, `--neg`…) zostały jako **aliasy** na końcu `tokens.css`,
żeby starszy kod Liczników działał bez zmian. W nowym kodzie używaj nazw semantycznych.
Kolory wybierane przez użytkownika (kategorie grafiku, karty lojalnościowe) to dane, nie tokeny.

## Dostępność i interakcja (zasady)

- **Kontrast**: tekst ≥ 4,5:1 w obu trybach (sprawdzone dla wszystkich par tokenów); obrysy kontrolek
  (`--color-border-strong`) ≥ 3:1. Linie podziału (`--color-border`) są celowo delikatne — tylko dekoracja.
- **Cele dotyku ≥ 44 px** (`--touch-min`): przyciski 44 px; małe elementy (pigułki, zakładki, `.btn.small`, ✎)
  mają niewidoczny, powiększony obszar kliknięcia — wygląd się nie zmienia. Odstęp między nimi ≥ 8 px.
- **Ikony**: jedna rodzina SVG z obrysem `--icon-stroke` (`icon()` w ui.js) — przyciski, listy zakupów, miejsca w spiżarni,
  powiadomienia, raport, znaczniki (paragon, oczekuje, ulubiony). Przycisk z samym znakiem (‹ › + ✕ ✎ ⟳ ⚙ ↑ ↓ ✓ − ★)
  albo tekstem zaczynającym się od „+ ” / „⇩ ” dostaje ikonę automatycznie (`a11yPass`), także w Licznikach i Grafiku.
  **Emoji zostają tylko jako kategorie**: kategorie wydatków (edytowalne) i działy sklepu na liście zakupów.
- **Fokus z klawiatury**: pierścień `--focus-ring` na wszystkim, co klikalne.
- **Dotknięcie**: każda kontrolka reaguje w `--duration-press` (zmiana tła/przezroczystości, bez przesuwania układu).
- **Praca w tle**: przycisk, który uruchomił zapis, dostaje `aria-busy` (kręciołek) i nie przyjmuje kolejnych kliknięć.
- **Komunikaty**: toast jest regionem `aria-live` (błąd = `role="alert"`).
- **Nawigacja**: aktywna sekcja ma `aria-current="page"`; ekrany podrzędne mają przycisk ‹ Wstecz w nagłówku.
- **Przyciski z samym symbolem** (‹ › + ✕ ⟳ …) dostają automatycznie nazwę dla czytnika ekranu.
- **Ograniczony ruch**: przy włączonym „Usuń animacje” w systemie przejścia i sprężyny są wyłączone.
