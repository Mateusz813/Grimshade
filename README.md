# Grimshade

Mobilna gra RPG (PWA). Repo składa się z dwóch części, obok siebie w `~/Desktop/Grimshade/`:

| Katalog | Co to | Stack | Port lokalnie |
|---|---|---|---|
| [`grimshade/`](.) | **Frontend** (ta aplikacja) | React 19 · Vite 8 · TypeScript | **5170** |
| [`../grimshade-backend/`](../grimshade-backend) | **Backend** (autorytatywny serwer) | PHP 8.2+ · Laravel 11 · Docker | **8088** |

Baza / Auth / Realtime to **Supabase** (współdzielone przez oba). Backend jest autorytetem
dla akcji gry (walka, market, itemy); front czyta dane wprost z Supabase.

---

## 🚀 Jak odpalić projekt lokalnie (front + backend)

> **TL;DR** — dwa terminale i wchodzisz na http://localhost:5170:
>
> ```bash
> # Terminal 1 — backend (Docker, nginx :8088 → PHP → Supabase)
> cd ~/Desktop/Grimshade/grimshade-backend && docker compose up -d
>
> # Terminal 2 — frontend (Vite :5170, HMR)
> cd ~/Desktop/Grimshade/grimshade && npm install && npm run dev
> ```
>
> Front jest już wpięty w lokalny backend (`grimshade/.env.local` → `VITE_API_BASE_URL=http://localhost:8088`,
> `VITE_BACKEND_DEFAULT=1`). Akcje gry lecą przez backend na `:8088`, logowanie i odczyty — przez Supabase.

### Wymagania

- **Node ≥ 22.12** (repo pinuje `22.21.1` w [`.nvmrc`](.nvmrc) — `nvm use` przełączy automatycznie).
- **Docker Desktop** uruchomiony (backend chodzi w kontenerach — **nie** potrzebujesz lokalnie PHP ani Composera).
- `grimshade/.env.local` z kluczami Supabase + wskazaniem na backend (jest — patrz [Konfiguracja env](#konfiguracja-env)).
- `grimshade-backend/.env` z danymi Supabase (jest — patrz [backend SETUP.md](../grimshade-backend/SETUP.md)).

---

### 1) Frontend (`grimshade/`)

```bash
cd ~/Desktop/Grimshade/grimshade
nvm use            # użyj wersji Node z .nvmrc (22.21.1)
npm install        # legacy-peer-deps=true jest w .npmrc — nie dodawaj flagi ręcznie
npm run dev        # Vite dev server → http://localhost:5170 (HMR)
```

Wejdź na **http://localhost:5170**.

> Zmieniłeś `.env.local`? **Zrestartuj `npm run dev`** — Vite czyta env tylko przy starcie.

Pozostałe komendy frontu:

```bash
npm run build       # produkcyjny build → dist/
npm run preview     # podgląd builda
npm run typecheck   # tsc -b (bez emisji)
npm run lint        # eslint
npm test            # vitest run (unit + integration)
npm run test:e2e    # build + Playwright (mobile-only E2E)
npm run test:all    # typecheck + vitest + Playwright
```

---

### 2) Backend (`grimshade-backend/`)

Masz dwa tryby — na co dzień do gry z frontem używaj **A (Docker)**.

#### A. Docker — live-dev loop na realną Supabase (domyślny)

Kod backendu jest bind-mountowany do kontenera z opcache `revalidate_freq=2`, więc **edycja
pliku PHP jest widoczna w ~2 s bez restartu**. Baza = produkcyjna Supabase (ten sam progres co front).

```bash
cd ~/Desktop/Grimshade/grimshade-backend
docker compose up -d          # nginx :8088 → php-fpm → Supabase
                              # --build tylko gdy zmieniłeś Dockerfile/zależności

# sanity check (bez logowania):
curl http://localhost:8088/                       # strona-wizytówka backendu (status LOKALNY)
curl http://localhost:8088/up                     # health Laravela
curl http://localhost:8088/api/v1/content/version # {"version":"..."}

docker compose logs -f app    # logi na żywo
docker compose down           # zatrzymaj
```

Kiedy zwykły edit nie wystarcza:

| Zmiana | Komenda |
|---|---|
| Kod PHP / trasa | nic — widoczne od razu (~2 s) |
| Zmienne w `.env` | `docker compose up -d` (recreate — `.env` wstrzykiwany przy starcie kontenera) |
| Nowa zależność w `composer.json` | `docker compose exec app composer install` |
| `Dockerfile` / `php.ini` | `docker compose up -d --build` |

> **Auth lokalnie:** Twoja Supabase wydaje tokeny **ES256**, więc backendowy `.env` musi mieć
> `SUPABASE_JWT_DRIVER=jwks` (jest ustawione). Z `hmac` każdy zalogowany request = **401**.
>
> ⚠️ **Baza jest PRODUKCYJNA** — testuj akcje gry na koncie `test@grimshade.pl`, nie na głównej postaci.

Pełny opis pętli front+backend: [../grimshade-backend/LOCAL_DEV.md](../grimshade-backend/LOCAL_DEV.md).

#### B. Offline na sqlite — tylko testy/dev backendu (bez Dockera, bez bazy)

Wymaga lokalnie **PHP 8.2+ i Composera**. Nie dotyka Supabase (sqlite in-memory).

```bash
cd ~/Desktop/Grimshade/grimshade-backend
composer install
cp .env.example .env
php artisan key:generate
php artisan test              # Pest — unit + feature
```

---

### Konfiguracja env

**Frontend — `grimshade/.env.local`** (gitignored, u Ciebie już jest):

| Zmienna | Wartość / rola |
|---|---|
| `VITE_SUPABASE_URL` | URL projektu Supabase |
| `VITE_SUPABASE_ANON_KEY` | publiczny klucz anon Supabase |
| `VITE_API_BASE_URL` | `http://localhost:8088` — adres lokalnego backendu |
| `VITE_BACKEND_DEFAULT` | `1` — akcje gry idą przez backend domyślnie (bez grzebania w localStorage) |

Przełącznik trybu w locie (DevTools, bez restartu Vite):

```js
localStorage.setItem('grimshade_backend_mode','0'); // wymuś client-authoritative (pomiń backend)
localStorage.removeItem('grimshade_backend_mode');   // wróć do domyślnego (ON w dev)
```

**Backend — `grimshade-backend/.env`** (gitignored): `DB_*` (Supabase session pooler, port 5432,
`DB_SSLMODE=require`), `SUPABASE_URL`, `SUPABASE_JWT_DRIVER=jwks`, `SUPABASE_JWT_SECRET`.
Pierwsze podłączenie krok po kroku: [../grimshade-backend/SETUP.md](../grimshade-backend/SETUP.md).

---

### Szybki test end-to-end (czy front gada z backendem)

1. Oba terminale wstały (backend `:8088`, front `:5170`).
2. Wejdź na http://localhost:5170, zaloguj się (Auth idzie do Supabase).
3. Wykonaj akcję gry (np. walkę) — request poleci do `http://localhost:8088/api/v1/...`.
4. Podgląd surowego endpointu z tożsamością (JWT z DevTools → Application → Local Storage → sesja Supabase → `access_token`):

   ```bash
   curl -H "Authorization: Bearer <JWT>" http://localhost:8088/api/v1/characters
   ```

### Najczęstsze problemy

| Objaw | Przyczyna / fix |
|---|---|
| Front działa, ale akcje gry nie uderzają w backend | Zmieniłeś `.env.local` bez restartu Vite → **zrestartuj `npm run dev`** |
| Zalogowany request → **401** z backendu | `SUPABASE_JWT_DRIVER` w backendowym `.env` ≠ `jwks` → ustaw `jwks` + `docker compose up -d` |
| `:8088` nie odpowiada | Docker Desktop nie działa / kontenery nie wstały → `docker compose up -d` + `docker compose logs -f app` |
| `npm install` sypie peer-deps error | `.npmrc` ma `legacy-peer-deps=true` — upewnij się, że jesteś w katalogu `grimshade/` |

---

## Dokumentacja projektu

- [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — **pełny dokument projektowy gry**: wszystkie mechaniki, formuły, szanse na drop, balans, koszty i progi (autorytatywny, wewnętrzny). **Aktualizowany przy KAŻDEJ zmianie mechaniki.**
- **Wiki gracza** — dostępna w grze pod `/wiki` (menu awatara → „Wiki", otwiera się w nowej karcie). Treść: [`src/data/wiki.ts`](src/data/wiki.ts), widok: [`src/views/Wiki/Wiki.tsx`](src/views/Wiki/Wiki.tsx). To player-facing, uproszczona wersja `GAME_DESIGN.md`.
- [`CLAUDE.md`](CLAUDE.md) — zasady projektu (workflow, testy, semver, stack, mechaniki, reguła utrzymania dokumentacji).
- [`../grimshade-backend/README.md`](../grimshade-backend/README.md) — architektura backendu, zmienne env, komendy.
- [`../grimshade-backend/LOCAL_DEV.md`](../grimshade-backend/LOCAL_DEV.md) — dev loop front+backend z live-edit.
- [`../grimshade-backend/SETUP.md`](../grimshade-backend/SETUP.md) — pierwsze podłączenie backendu do Supabase, CI/CD.

> **Reguła utrzymania (obowiązkowa):** po każdej zmianie backendu lub frontu dotykającej mechaniki — zaktualizuj `docs/GAME_DESIGN.md` **oraz** Wiki gracza (`src/data/wiki.ts`) **oraz** `CLAUDE.md`/`.claude/spec`. Nowy feature = opis we wszystkich trzech. Szczegóły w [`docs/GAME_DESIGN.md` §30](docs/GAME_DESIGN.md#30-reguła-utrzymania-obowiązkowe).

---

## Referencja: szablon React + TypeScript + Vite

Projekt startował z oficjalnego szablonu Vite. Dwa oficjalne pluginy React:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) — używa [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) — używa [SWC](https://swc.rs/)

### Rozszerzona konfiguracja ESLint

Dla aplikacji produkcyjnej warto włączyć reguły type-aware:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
])
```

Można też dołączyć [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x)
i [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom):

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      reactX.configs['recommended-typescript'],
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
])
```
