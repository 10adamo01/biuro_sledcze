# Biuro Śledcze — wspólna gra detektywistyczna

Strona do wspólnego rozwiązywania spraw kryminalnych:

- logowanie przez **Discord**,
- **pokoje śledztwa** z kodem i linkiem-zaproszeniem,
- **akta** (raporty, przesłuchania, paragony, notesy, mapy) — widać, kto co czyta,
- **tablica dowodów** z karteczkami i czerwonymi nitkami — synchronizowana na żywo,
- **wspólny notatnik** i dziennik śledztwa,
- **wnioski**, które odblokowują nowe dokumenty,
- **podpowiedzi** za punkty i jedna wspólna **odpowiedź drużyny** z wynikiem i rozwiązaniem,
- **własne sprawy**: każdy gracz może założyć pokój z własnego pliku `.json` — taka sprawa jest widoczna tylko w tym pokoju,
- **panel admina**: wgrywanie spraw publicznych (widocznych dla wszystkich na liście).

Strona jest statyczna (działa na GitHub Pages / Twojej domenie), a bazą, logowaniem i synchronizacją zajmuje się darmowy **Supabase**.

## Pliki

| Plik | Co to |
|---|---|
| `index.html`, `app.js`, `style.css` | strona |
| `config.js` | **tu wpisujesz** adres i klucz Supabase |
| `schema.sql` | baza danych — wklejasz raz w Supabase |
| `cases/pod-zegarem.json` | pierwsza sprawa do wgrania |
| `FORMAT_SPRAWY.md` | opis formatu spraw (dokumentacja) |
| `PROMPT_AI.md` | gotowy prompt do AI generujący nowe sprawy — strona wyświetla go w zakładce **📖 Instrukcja** |

---

## Instalacja krok po kroku (~20 minut)

### 1. Projekt Supabase
1. Załóż konto na <https://supabase.com> i kliknij **New project** (region np. *Central EU (Frankfurt)*).
2. Wejdź w **SQL Editor → New query**, wklej całą zawartość `schema.sql` i kliknij **Run**. Powinno pokazać „Success”.

### 2. Aplikacja na Discordzie
1. Wejdź na <https://discord.com/developers/applications> → **New Application** (np. „Biuro Śledcze”).
2. Zakładka **OAuth2**: skopiuj **Client ID**, kliknij **Reset Secret** i skopiuj **Client Secret**.
3. W **Redirects** dodaj adres (podmień `TWOJ-PROJEKT` na swój — znajdziesz go w Supabase w *Project Settings → API*):
   ```
   https://TWOJ-PROJEKT.supabase.co/auth/v1/callback
   ```
   i zapisz (**Save Changes**).

### 3. Logowanie Discord w Supabase
1. Supabase → **Authentication → Sign In / Providers → Discord** → włącz.
2. Wklej **Client ID** i **Client Secret** z Discorda → **Save**.
3. **Authentication → URL Configuration**:
   - **Site URL**: adres, pod którym będzie gra, np. `https://zawlox.pl/detektyw/`
     (albo `https://10adamo01.github.io/Social_Media/detektyw/`).
   - **Redirect URLs**: dodaj ten sam adres. Do testów na komputerze możesz dodać też `http://localhost:5500/`.

### 4. Konfiguracja strony
Otwórz `config.js` i wpisz dane z Supabase → **Project Settings → API** (lub *Data API*):
```js
SUPABASE_URL: "https://TWOJ-PROJEKT.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi…",   // klucz "anon" / "publishable"
```
Klucz *anon* jest publiczny i bezpieczny (dostęp chronią reguły w bazie). **Nigdy** nie wklejaj klucza *service_role / secret*.

### 5. Wrzucenie na stronę
Najprościej: wrzuć cały folder (bez zmian w nazwach plików) do repozytorium z Twoją stroną, np. jako podfolder `detektyw/`
w repo `Social_Media`. Po chwili gra będzie pod `…/Social_Media/detektyw/` lub `zawlox.pl/detektyw/`.
Adres musi zgadzać się z tym z kroku 3.

### 6. Zostań adminem
1. Wejdź na stronę i zaloguj się przez Discord.
2. W Supabase → **SQL Editor** uruchom (podmień nick na swój z Discorda):
   ```sql
   select id, name from public.profiles;
   insert into public.admins (user_id) select id from public.profiles where name = 'Zawlox';
   ```
3. Odśwież stronę — w lobby pojawi się **Panel admina**.

### 7. Pierwsza sprawa
Panel admina → **Wgraj sprawę (.json)** → wybierz `cases/pod-zegarem.json`.
Potem: *Nowe śledztwo* → **Rozpocznij** → kliknij **Kod: XXXXXX 🔗** i wyślij link znajomym na Discordzie.

---

## Nowe sprawy
**Każdy gracz:** lobby → *Nowe śledztwo* → **📂 Własna sprawa z pliku** → wybierz plik → **Utwórz pokój**. Sprawa jest prywatna (tylko ten pokój); założyciel może w *Notatki → Plik sprawy* wgrać poprawioną wersję. Gdy pokój opustoszeje, sprawa jest usuwana. Limit: 15 własnych spraw na dobę na osobę, plik do 3 MB.

**Admin (sprawy publiczne):**
1. Na stronie kliknij **📖 Instrukcja** → sekcja **Prompt**. Uzupełnij parametry (temat, miejsce, trudność…) i kliknij **Kopiuj prompt**.
   (Ten sam prompt jest w pliku `PROMPT_AI.md` — możesz go też wkleić ręcznie.)
2. Wklej prompt do AI w nowej rozmowie, zapisz odpowiedź jako plik `.json`.
3. Sprawdź go przyciskiem **Podgląd pliku**, potem **Wgraj sprawę**.
4. Wgranie pliku z tym samym `id` aktualizuje sprawę (np. poprawki literówek).
5. **Pobierz JSON** w panelu admina zwraca pełny plik sprawy, a **Usuń** kasuje sprawę razem z jej pokojami.

## Jak grać
Pełna instrukcja dla graczy jest na stronie pod przyciskiem **📖 Instrukcja** (działa też bez logowania).

- **Akta** — czytajcie dokumenty; obok tytułów widać avatary osób, które je właśnie czytają. Przycisk 📌 przypina dokument na tablicę.
- **Wnioski** — wpiszcie trafną odpowiedź, a do akt trafią nowe materiały.
- **Tablica** — „＋ Karteczka” dodaje notatkę, „🧵 Połącz nitką” → kliknij dwa elementy. Kliknięcie nitki ją usuwa.
- **Notatki** — wspólny notatnik, lista drużyny i dziennik zdarzeń.
- **Rozwiązanie** — podpowiedzi (każda −1 pkt dla drużyny) i jedna, ostateczna odpowiedź. Po wysłaniu wszyscy widzą wynik i pełne rozwiązanie.

## Aktualizacja strony
Gdy dostaniesz nową wersję: podmień pliki na serwerze i **jeszcze raz uruchom cały `schema.sql`** w Supabase → SQL Editor (skrypt jest bezpieczny do powtórzenia — nie kasuje danych).

## Najczęstsze problemy
| Objaw | Rozwiązanie |
|---|---|
| Po zalogowaniu wraca na stronę logowania / błąd „redirect” | Adres strony musi być w *Authentication → URL Configuration* (Site URL i Redirect URLs), łącznie z końcowym `/`. |
| Discord pokazuje „Invalid OAuth2 redirect_uri” | W Discordzie (OAuth2 → Redirects) musi być `https://TWOJ-PROJEKT.supabase.co/auth/v1/callback`. |
| „Strona nie jest jeszcze skonfigurowana” | Uzupełnij `config.js`. |
| Brak panelu admina | Wykonaj krok 6 i odśwież stronę. |
| Zmiany innych graczy nie pojawiają się na żywo | Sprawdź, czy `schema.sql` wykonał się do końca (dodaje tabele do *Realtime*). Odśwież stronę. |
| „new row violates row-level security policy” przy wgrywaniu | Nie jesteś adminem (krok 6). |
