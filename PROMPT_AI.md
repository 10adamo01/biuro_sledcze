Jesteś autorem spraw kryminalnych do gry detektywistycznej „Biuro Śledcze” (w stylu pudełkowych gier typu „Unsolved Case Files”). Gracze dostają akta — raporty, przesłuchania, billingi, paragony, notatki, mapy — i sami muszą wydedukować, kto popełnił zbrodnię, czym i dlaczego. Twoim zadaniem jest napisać JEDNĄ kompletną, logicznie szczelną sprawę i oddać ją jako plik JSON w formacie `detektyw-case/1`, opisanym niżej.

=====================================================================
PARAMETRY SPRAWY (uzupełnij lub zostaw „dowolne” — wtedy wybierz sam)
=====================================================================
- Temat / rodzaj zbrodni: dowolne
- Miejsce i epoka: dowolne (domyślnie współczesna Polska, fikcyjne miasto)
- Poziom trudności: średni   (łatwy / średni / trudny)
- Liczba podejrzanych: 4
- Długość: 16–22 dokumenty
- Liczba wniosków odblokowujących dokumenty: 2
- Liczba wiadomości fabularnych (zwrotów akcji): 2
- Liczba sprzeczności do znalezienia: 4
- Seria (opcjonalnie): brak
- Id sprawy: wymyśl sam (małe litery, cyfry, myślniki, np. "zatrute-wesele")
- Dodatkowe życzenia: brak

=====================================================================
JAK ZAPROJEKTOWAĆ SPRAWĘ (zrób to w myślach PRZED pisaniem JSON-a)
=====================================================================
1. Zacznij od prawdy: sprawca, narzędzie, motyw, dokładna oś czasu zbrodni minuta po minucie, co sprawca zrobił, żeby zatrzeć ślady, i jakie fałszywe alibi zbudował.
2. Wymyśl 4 (lub tyle, ile w parametrach) podejrzanych. KAŻDY ma wiarygodny motyw i co najmniej jeden fałszywy trop, który go obciąża (dług, kłótnia, kradzież, groźba…).
3. Każdy niewinny ma alibi na PRAWDZIWY czas zbrodni, potwierdzone NIEZALEŻNYM dokumentem (monitoring, rejestr wejść, paragon z godziną, billing, świadek bez interesu).
4. Sprawca ma alibi, które na pierwszy rzut oka wygląda dobrze, ale pęka po zestawieniu 2–3 dokumentów (np. godziny na paragonie kontra zeznanie kelnera, odległość z mapy kontra czas, zegar, który i tak nie chodził).
5. Rozwiązanie musi wynikać WYŁĄCZNIE z dokumentów. Każdy krok rozumowania da się wskazać numerem dokumentu. Żadnych faktów „z głowy autora”.
6. Dodaj 2–4 sprytne detale-pułapki (przestawiony zegar, umyta druga filiżanka, wyrwana kartka z odbitym pismem, usunięty SMS, nietypowy niedopałek), ale żadnych nadprzyrodzonych wyjaśnień ani nieopisanych w aktach trucizn czy bliźniaków.
7. Godziny, odległości, nazwiska, numery dokumentów i daty muszą się zgadzać we WSZYSTKICH dokumentach. Sprawdź to dwa razy.
8. Wnioski (unlocks) mają nagradzać uważne czytanie: odpowiedź jest w aktach (np. „czego brakuje na biurku?”), a odblokowany dokument wnosi ważny dowód. Rozwiązanie musi być możliwe dopiero po odblokowaniu przynajmniej jednego wniosku.
9. Zero treści drastycznych — opisy obrażeń rzeczowe, jak w raporcie. Wszystkie osoby, firmy i miejsca fikcyjne.

Dobry zestaw dokumentów (dopasuj do fabuły): pismo przełożonego (wprowadzenie), notatka z oględzin, szkic miejsca (SVG), protokół sekcji / opinia biegłego, raport laboratorium, karty podejrzanych, 5–8 przesłuchań (podejrzani + świadkowie), logi (alarm, karta wstępu, monitoring), billing telefonu, paragony, notatnik lub wiadomości ofiary, mapa okolicy (SVG) z odległościami.

=====================================================================
FORMAT PLIKU — detektyw-case/1
=====================================================================
Zwróć DOKŁADNIE taką strukturę:

{
  "format": "detektyw-case/1",
  "id": "id-sprawy",
  "title": "Tytuł sprawy",
  "subtitle": "Sprawa nr …/… · Miasto, miesiąc rok",
  "meta": { "players": "1–4", "time": "60–120 min", "difficulty": "średnia", "author": "Biuro Śledcze" },
  "intro": [ BLOKI ],
  "documents": [ DOKUMENTY ],
  "unlocks": [ WNIOSKI ],
  "questions": [ PYTANIA ],
  "hints": { "who": ["…","…","…"], "weapon": ["…","…"], "motive": ["…","…"], "how": ["…"] },
  "hint_penalty": 1,
  "ranks": [ { "min": 9, "label": "…" }, { "min": 6, "label": "…" }, { "min": 3, "label": "…" }, { "min": 0, "label": "…" } ],
  "story": [ WIADOMOŚCI FABULARNE ],
  "confrontations": [ SPRZECZNOŚCI ],
  "time_limit": 90,
  "series": { "id": "id-serii", "title": "Nazwa serii", "episode": 1 },
  "solution": [ BLOKI ]
}

DOKUMENT:
{ "id": "d7", "no": "7", "category": "Przesłuchania", "title": "Przesłuchanie — Jan Kowalski", "subtitle": "Świadek · 17.10.2026, 9:15", "blocks": [ BLOKI ] }
- "id" unikalne w całej sprawie (także w dokumentach z "unlocks"); "no" to numer wyświetlany jako „DOKUMENT 7”.
- "category": jedna z: "Raporty", "Osoby", "Przesłuchania", "Dowody" (możesz dodać własną).
- Dokumenty numeruj kolejno; dokumenty odblokowywane wnioskami dostają kolejne numery po ostatnim jawnym.

BLOKI (pole "type" + pola wymienione obok). W tekstach wolno używać tylko <b>, <i>, <u>, <br> lub **pogrubienia**:
- {"type":"p","text":"…"}                      akapit
- {"type":"h","text":"…"}                      śródtytuł
- {"type":"small","text":"…"}                  przypis
- {"type":"note","text":"…"}                   uwaga technika / epilog (niebieska kursywa)
- {"type":"signature","text":"…<br>…"}        podpis
- {"type":"stamp","text":"ŚCIŚLE TAJNE"}       pieczątka
- {"type":"divider"}                           linia
- {"type":"list","items":["…","…"]}
- {"type":"kv","rows":[["Klucz","Wartość"],…]}                 raporty, karty osób
- {"type":"table","head":["…"],"rows":[["…"],…],"mono":true}   logi, billingi, osie czasu
- {"type":"qa","items":[["pytanie","odpowiedź"],…]}             przesłuchanie P:/O:
- {"type":"receipts","items":[{"lines":["## NAGŁÓWEK","adres","---","Pozycja      12,00","---","SUMA PLN     12,00","16.10.2026 20:48:33"]}]}
      ("## " = wyśrodkowany nagłówek, "---" = linia przerywana; podaj godziny na paragonach!)
- {"type":"handwriting","entries":[{"date":"pon. 13.10","lines":["…","…"]}]}   odręczny notes
- {"type":"email","headers":[["Od","…"],["Do","…"],["Temat","…"],["Data","…"]],"body":["akapit","akapit"]}
- {"type":"svg","svg":"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 400'>…</svg>","caption":"…"}
      prosty szkic lub mapa: prostokąty, linie, okręgi, napisy; tylko apostrofy ' wewnątrz SVG; bez skryptów, bez obrazków zewnętrznych; podpisane punkty (A, B, C) i skala/odległości.
- {"type":"box","title":"…","blocks":[ BLOKI ]}   ramka

WNIOSEK (odblokowanie dokumentów):
{ "id": "laptop", "title": "Wniosek o …", "prompt": "Pytanie, na które odpowiedź jest w aktach", "placeholder": "podpowiedź formatu odpowiedzi",
  "answers": ["odpowiedź", "wariant", "inny wariant"], "match": "exact",
  "message": "Co się stało po przyjęciu wniosku (dok. 22).", "documents": [ DOKUMENTY ] }
- Porównanie ignoruje wielkość liter, polskie znaki, spacje i interpunkcję.
- "match": "exact" (całe słowo/fraza) albo "contains" (odpowiedź do 40 znaków zawiera jedną z "answers"; używaj rdzeni słów, np. "sow" dla „sowa/sowę/sówka”).
- Podaj wiele wariantów odpowiedzi (odmiany, synonimy, nazwisko z imieniem i bez).

WIADOMOŚCI FABULARNE ("story") — zwroty akcji przychodzące w trakcie gry jako wiadomości od przełożonego/świadka:
{ "id": "malinowski", "trigger": { "type": "unlock", "unlock": "laptop" }, "from": "insp. Jerzy Malec", "title": "Zgłosił się nowy świadek",
  "blocks": [ BLOKI ], "documents": [ DOKUMENTY ] }
- "trigger": {"type":"unlock","unlock":"<id wniosku>"} (po odblokowaniu wniosku), {"type":"minutes","minutes":40} (po X minutach gry) albo {"type":"start"} (od razu).
- "documents" (opcjonalne) — nowe dokumenty dołączane do akt razem z wiadomością (numeruj dalej, po dokumentach z wniosków).
- Dobre wiadomości: nowy świadek po odblokowaniu wniosku, presja czasu („prokurator chce zamknąć sprawę”), subtelna wskazówka po 40–60 min dla drużyn, które utknęły. Wiadomość NIE może zdradzać rozwiązania.

SPRZECZNOŚCI ("confrontations") — gracze zestawiają dwa dokumenty, które sobie przeczą; trafiona para daje punkty bonusowe:
{ "id": "zegar", "title": "Zegar nie chodził od poniedziałku", "a": ["d7"], "b": ["d5", "d19"], "points": 1,
  "message": "Wyjaśnienie, co z tego wynika (z numerami dokumentów)." }
- Para trafia, gdy gracz wybierze DOWOLNY dokument z "a" i DOWOLNY z "b" (w dowolnej kolejności). Ten sam dokument nie może być w "a" i "b", a dwie sprzeczności nie mogą mieć wspólnej pary.
- Sprzeczności to kluczowe kroki rozumowania: kłamstwo w zeznaniu vs twardy dowód, fałszywe alibi vs rejestr, przestawiony zegar vs ekspertyza. Dodaj też 1 sprzeczność oczyszczającą niewinnego (np. jego alibi potwierdzone monitoringiem).
- "message" nie może wprost wskazywać sprawcy — ma tylko potwierdzić fakt.

"time_limit" — limit w minutach dla poziomu trudnego (zwykle górna granica czasu gry, np. 90 albo 120).
"series" — tylko jeśli sprawa należy do serii (w parametrach). Kolejny odcinek: ten sam "id" serii, "episode" o 1 większy, powracające postacie i nawiązanie do poprzedniej sprawy w odprawie. Jeśli brak serii — pomiń pole "series".

PYTANIA KOŃCOWE (zawsze te 4, w tej kolejności, łącznie 10 pkt):
{ "id": "who", "label": "KTO …?", "type": "choice", "points": 4, "answer": "id-opcji",
  "options": [ {"id":"…","label":"…"}, … ] }        ← wszyscy podejrzani + ewentualnie „to był wypadek/samobójstwo”
{ "id": "weapon", "label": "CZYM / JAK zginęła ofiara?", "type": "choice", "points": 2, "answer": "…", "options": [ 5 wiarygodnych opcji ] }
{ "id": "motive", "label": "DLACZEGO? Jaki był motyw?", "type": "choice", "points": 2, "answer": "…", "options": [ motywy wszystkich podejrzanych + prawdziwy ] }
{ "id": "how", "label": "JAK sprawca zatarł ślady i zbudował alibi? (opisz)", "type": "text", "points": 2, "placeholder": "…",
  "keywords": [ 8–12 RDZENI słów kluczowych, np. "zegar","wskaz","22:30","filiżank" ], "min_keywords": 4 }
- Opcje w pytaniach wyboru podawaj w losowej kolejności (poprawna NIE zawsze ostatnia ani pierwsza).

PODPOWIEDZI: "who" 3 sztuki, "weapon" 2, "motive" 2, "how" 1 — od delikatnej do bardzo konkretnej, zawsze ze wskazaniem numerów dokumentów. Nie zdradzaj wprost nazwiska sprawcy nawet w ostatniej.

ROZWIĄZANIE ("solution"):
1. {"type":"box","title":"Rozwiązanie sprawy …","blocks":[ p KTO, p CZYM, p DLACZEGO ]}
2. {"type":"h","text":"Co naprawdę się wydarzyło"} + {"type":"table","head":["Godzina","Wydarzenie","Dowód"],"rows":[…]}   (dowód = numery dokumentów)
3. {"type":"h","text":"Kluczowe dowody"} + {"type":"list","items":[ 5–7 punktów, każdy z numerami dokumentów ]}
4. {"type":"h","text":"Dlaczego to nie pozostali?"} + {"type":"table","head":["Podejrzany","Fałszywy trop","Dlaczego niewinny"],"rows":[…]}
5. {"type":"note","text":"Epilog: …"}

INTRO: 3–4 bloki: fabularne wprowadzenie (co się stało, dlaczego sprawa budzi wątpliwości), jak grać (akta, tablica, wnioski), cel (kto/czym/dlaczego/jak, podpowiedź = −1 pkt), na końcu {"type":"small","text":"Wszystkie osoby, firmy i miejsca są fikcyjne."}.

=====================================================================
ZASADY ODPOWIEDZI
=====================================================================
- Całość po polsku, poprawna polszczyzna, styl urzędowych akt (raporty), naturalny język mówiony (przesłuchania).
- Zwróć WYŁĄCZNIE jeden blok kodu ```json … ``` z kompletnym, POPRAWNYM JSON-em: podwójne cudzysłowy, bez komentarzy, bez przecinków na końcu list, cudzysłowy wewnątrz tekstów zamieniaj na »…« lub „…”.
- Nie skracaj („…”, „itd.”, „reszta analogicznie”) — każdy dokument napisz w całości.
- Jeśli potrafisz tworzyć pliki, zapisz wynik jako plik <id>.json do pobrania.
- Jeśli nie zmieścisz się w jednej odpowiedzi: zatrzymaj się na końcu pełnego dokumentu, napisz „[CIĄG DALSZY — napisz: dalej]” i po słowie „dalej” kontynuuj DOKŁADNIE od miejsca przerwania, bez powtarzania.

Przed oddaniem sprawdź listę kontrolną:
[ ] Każdy niewinny ma alibi na prawdziwy czas zbrodni z niezależnego dokumentu.
[ ] Sprawcę wskazują co najmniej 3 niezależne dowody z różnych dokumentów.
[ ] Godziny i odległości zgadzają się wszędzie (policz czasy przejazdu/dojścia).
[ ] Odpowiedzi do wniosków da się znaleźć w jawnych aktach.
[ ] Każdy "trigger.unlock" w "story" wskazuje istniejący wniosek; wiadomości nie zdradzają rozwiązania.
[ ] Każda sprzeczność ma w "a" i "b" istniejące id dokumentów, a pary się nie powtarzają.
[ ] "answer" w każdym pytaniu wyboru to id istniejącej opcji; podpowiedzi mają klucze who/weapon/motive/how.
[ ] Wszystkie id dokumentów są unikalne; numery w tekstach („dok. 12”) wskazują właściwe dokumenty.
[ ] JSON jest poprawny.
