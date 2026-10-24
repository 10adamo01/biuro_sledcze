# Format pliku sprawy — `detektyw-case/1`

Jedna sprawa = **jeden plik `.json`**. Każdy gracz może założyć z nim pokój (lobby → *Nowe śledztwo* → **📂 Własna sprawa z pliku**) — wtedy sprawa jest widoczna tylko w tym pokoju. Admin może też wgrać ją publicznie (*Panel admina* → **Wgraj sprawę**).
Strona sama rozdziela plik na część jawną (akta) i tajną (odpowiedzi, zablokowane dokumenty, podpowiedzi, rozwiązanie).
Gracze **nie mają dostępu** do części tajnej, dopóki jej nie odblokują w grze.

> Najprościej generować sprawy gotowym promptem: na stronie **📖 Instrukcja → Prompt → Kopiuj prompt**
> (albo plik `PROMPT_AI.md`). Ten dokument to szczegółowa dokumentacja formatu.

Przed wgraniem możesz sprawdzić plik przyciskiem **Podgląd pliku** (pokazuje błędy i całą sprawę z rozwiązaniem).

---

## Struktura

```json
{
  "format": "detektyw-case/1",
  "id": "pod-zegarem",
  "title": "Śmierć w antykwariacie »Pod Zegarem«",
  "subtitle": "Sprawa nr 26/417/K · Kalinów, październik 2026",
  "meta": { "players": "1–4", "time": "60–120 min", "difficulty": "średnia", "author": "Biuro Śledcze" },

  "intro":     [ /* bloki — odprawa widoczna na start */ ],
  "documents": [ /* dokumenty dostępne od początku */ ],
  "unlocks":   [ /* wnioski odblokowujące kolejne dokumenty */ ],
  "questions": [ /* pytania końcowe */ ],
  "hints":     { "who": ["…", "…"], "weapon": ["…"] },
  "hint_penalty": 1,
  "ranks":     [ { "min": 9, "label": "Mistrzowska robota!" }, { "min": 0, "label": "Sprawa umorzona…" } ],
  "solution":  [ /* bloki — pokazywane po wysłaniu odpowiedzi */ ]
}
```

| Pole | Wymagane | Opis |
|---|---|---|
| `format` | tak | zawsze `"detektyw-case/1"` |
| `id` | tak | 3–60 znaków: małe litery, cyfry, myślniki. Wgranie pliku z tym samym `id` **nadpisuje** sprawę |
| `title` | tak | tytuł sprawy |
| `subtitle`, `meta` | nie | podtytuł; `meta.players`, `meta.time`, `meta.difficulty`, `meta.author` |
| `documents` | tak | lista dokumentów (min. 1) |
| `questions` | tak | lista pytań (min. 1) |
| `unlocks`, `hints`, `ranks`, `solution`, `intro` | nie | patrz niżej |

---

## Dokument

```json
{
  "id": "d7",
  "no": "7",
  "category": "Przesłuchania",
  "title": "Przesłuchanie — Igor Sadowski",
  "subtitle": "Świadek · 17.10.2026, 9:15",
  "blocks": [ /* bloki treści */ ]
}
```

- `id` — unikalny w całej sprawie (także wśród dokumentów w `unlocks`).
- `no` — numer wyświetlany jako „DOKUMENT 7” (tekst, może być np. `"17A"`).
- `category` — grupa w spisie akt, np. `Raporty`, `Osoby`, `Przesłuchania`, `Dowody`. Kolejność grup = kolejność pierwszego wystąpienia.

## Bloki treści

W tekstach można używać `<b>`, `<i>`, `<u>`, `<br>` oraz `**pogrubienia**`. Inny HTML jest wyświetlany jako zwykły tekst.

| `type` | Pola | Wygląd |
|---|---|---|
| `p` | `text` | akapit |
| `h` | `text` | śródtytuł |
| `small` | `text` | drobny szary tekst / przypis |
| `note` | `text` | niebieska kursywa (uwaga technika, epilog) |
| `signature` | `text` | podpis wyrównany do prawej |
| `stamp` | `text` | czerwona pieczątka, np. „ŚCIŚLE TAJNE” |
| `divider` | — | pozioma linia |
| `list` | `items: ["…"]` | lista punktowana |
| `kv` | `rows: [["Klucz","Wartość"], …]` | tabela klucz–wartość (raporty, karty osób) |
| `table` | `head: [...]`, `rows: [[...], …]`, `mono: true/false` | tabela (billingi, logi, oś czasu); `mono` = czcionka maszynowa |
| `qa` | `items: [["pytanie","odpowiedź"], …]` | protokół przesłuchania P:/O: |
| `receipts` | `items: [{ "lines": [...] }, …]` | paragony obok siebie |
| `receipt` | `lines: [...]` | pojedynczy paragon |
| `handwriting` | `entries: [{ "date": "pon. 13.10", "lines": ["…"] }]` | odręczny notes |
| `email` | `headers: [["Od","…"], …]`, `body: ["akapit", …]` | e-mail |
| `svg` | `svg: "<svg …>…</svg>"`, `caption` | rysunek/mapa/szkic (wyświetlany jako obrazek, bez skryptów) |
| `image` | `src: "https://…"` lub `data:image/png;base64,…`, `caption` | zdjęcie |
| `box` | `title`, `blocks: [...]` | ramka z zagnieżdżonymi blokami |

**Paragony (`lines`)**: wiersz zaczynający się od `##` to wyśrodkowany nagłówek, `---` to przerywana linia, reszta to tekst maszynowy (spacje są zachowane).

---

## Wnioski (`unlocks`) — odblokowywanie dokumentów

Gracze składają wniosek, wpisując odpowiedź. Trafna odpowiedź dodaje dokumenty do akt całej drużyny.

```json
{
  "id": "laptop",
  "title": "Wniosek o złamanie hasła laptopa ofiary",
  "prompt": "Jakiej marki był zegar, który niepokoił ofiarę?",
  "placeholder": "nazwisko zegarmistrza",
  "answers": ["Le Roy", "Julien Le Roy"],
  "match": "exact",
  "message": "Laptop odblokowany. W kopiach roboczych znaleziono e-mail (dok. 20).",
  "documents": [ { "id": "d20", "no": "20", "title": "…", "blocks": [ … ] } ]
}
```

- Porównanie ignoruje wielkość liter, polskie znaki, spacje i interpunkcję (`"Le-Roy!"` = `"leroy"`).
- `match: "exact"` — odpowiedź musi równać się jednej z `answers`.
- `match: "contains"` — wystarczy, że odpowiedź (do 40 znaków) **zawiera** jedną z `answers`. Dobre dla rdzeni słów, np. `"sow"` łapie „sowa”, „sowę”, „sówka”.
- Nietrafione próby widzi cała drużyna w dzienniku — bez kar punktowych.

## Pytania końcowe (`questions`)

Drużyna wysyła jedną wspólną odpowiedź, raz.

Wybór z listy:
```json
{ "id": "who", "label": "KTO zabił?", "type": "choice", "points": 4, "answer": "zielinski",
  "options": [ { "id": "marta", "label": "Marta Wolska" }, { "id": "zielinski", "label": "dr Paweł Zieliński" } ] }
```

Odpowiedź opisowa (oceniana automatycznie po słowach-kluczach):
```json
{ "id": "how", "label": "JAK sprawca zatarł ślady?", "type": "text", "points": 2,
  "placeholder": "Opisz…", "keywords": ["zegar", "wskaz", "22:30", "drabin", "filiżank"], "min_keywords": 4 }
```
Słowa-klucze to najlepiej **rdzenie** (`"filiżank"` łapie filiżankę/filiżanki). Pytanie jest zaliczone, gdy odpowiedź zawiera co najmniej `min_keywords` z nich.

## Podpowiedzi, kary i rangi

- `hints` — obiekt `{ "id_pytania": ["podpowiedź 1", "podpowiedź 2", …] }`, od najsłabszej do najmocniejszej. Odsłaniane po kolei, widoczne dla całej drużyny.
- `hint_penalty` — ile punktów kosztuje każda podpowiedź (domyślnie 1).
- `ranks` — `[{ "min": punkty, "label": "tekst" }]`; pokazywana jest ranga o najwyższym `min` ≤ wynik.

## Rozwiązanie (`solution`)

Lista bloków (jak w dokumencie). Pokazywana dopiero po wysłaniu odpowiedzi. Dobrze sprawdza się: `box` z odpowiedziami → `table` z prawdziwą osią czasu → `list` kluczowych dowodów z numerami dokumentów → `table` „dlaczego nie pozostali” → `note` z epilogiem.

---

## Zasady dobrej sprawy (dla autora)

1. Rozwiązanie musi wynikać **wyłącznie z dokumentów** — każdy wniosek da się wskazać numerem dokumentu.
2. Każdy podejrzany ma motyw i fałszywy trop; niewinni mają alibi potwierdzone **niezależnym** dokumentem (monitoring, rejestr, świadek).
3. Kluczowa sprzeczność powinna wymagać zestawienia co najmniej 2–3 dokumentów.
4. Wnioski (`unlocks`) nagradzają uważne czytanie — odpowiedź jest w aktach, a nie w głowie autora.
5. Godziny, odległości i nazwiska muszą się zgadzać we wszystkich dokumentach.
