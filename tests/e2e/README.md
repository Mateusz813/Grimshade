# E2E tests — Playwright

## Filozofia

**Atomic E2E.** Każdy plik `*.spec.ts` testuje JEDNĄ rzecz. Krótki,
focused, deterministyczny.

- ❌ NIE: "user journey" testy (login → walka → loot → save → logout
  w jednym pliku). Gdy wybuchają — nie wiadomo gdzie błąd.
- ✅ TAK: każdy scenariusz osobno (`login-success.spec.ts`,
  `combat-attack-deals-damage.spec.ts`, `loot-drops-on-kill.spec.ts`).

## Vitest coverage (2026-05-26)

E2E + unit są komplementarne: unity (vitest) walidują logikę game-state w izolacji, E2E (Playwright) walidują flow przez prawdziwy DOM + Supabase. Pełna tabela coverage per folder w `CLAUDE.md` (sekcja "Vitest coverage"). High-level: **4306 unit/integration testów w 189 plików** — `src/systems/` powyżej threshold 55/35/70/55 wymaganego przez `vitest.config.ts`. **2026-05-26 BACKLOG 6.10/6.11/12.7 closure**: +10 testów (`src/systems/sellRefund.test.ts` 5 testów — composed `getSellPrice + getEnhancementRefund` contract, common/rare +0/+2 cases + stone-count invariant + sell-price = base+refund matrix; `src/systems/systemChatMessages.test.ts` 5 nowych integration tests w dwóch describe-ach `Integration › chatApi.postSystemEvent + format + parse` — item-upgrade + skill-upgrade variants, każdy z Polish-character round-trip + parser-branch isolation). Najsłabsza pojedyncza luka: `combatEngine.ts` 22% (orchestrator, 3059 LOC — walidowany przez `combatSim` E2E fixture, real unit-test wymagałby mockowania 12+ store-ów).

## Aktualny stan suite (2026-05-25)

- **172 spec files × 2 mobile profiles = ~390 test runs** (mobile-safari iPhone 13 + mobile-chrome Pixel 7; includes parametrized loops like per-class smoke E×7 + each-class-creates E×7 + deaths per-combat-type E×5)
- **14 fixtures** w `fixtures/` — `adminClient` (cached findUserIdByEmail per worker; kluczowe dla DB load), `combatSim` (SKIP-resolve + live combat + triggerPlayerDeath), `multiContext` (party/guild/friends/chat z 2 niezależnymi browser contexts), `seedGameSave` (+ NEW `transforms` slot 2026-05-25 round-5) / `seedInventory` / `seedQuestState` / `seedDeath` / `seedGuild` / **NEW** `seedWeaponSkill` (DELETE+INSERT do character_weapon_skills dla weapon-skill ranking tests), `guildCleanup`, `login`, `createCharacter` (+11 nowych ranking column overrides 2026-05-25 round-5), `cleanup`, `testUsers`
- **Workers=1 globally** — wszystkie testy sequential, max 2 concurrent chars na primary (poniżej 7-limit). Zoptymalizowane po 2026-05-25 DB outage (NANO compute spike 82% CPU)
- **App-side bug fixes uzyskane jako side effect**: Boss.tsx / Transform.tsx / Dungeon.tsx / Trainer.tsx — wszystkie Rules of Hooks violations (early-return przed hooks) odkryte przez testy, naprawione w app
- **Migracje SQL** (drafty, nieaplikowane): `scripts/character_unique_nick_migration.sql` (BACKLOG 2.7), `scripts/characters_public_select_rls_migration.sql` (4.10) — wymagają owner-decision o privacy/UX
- **BACKLOG.md** (po sync 2026-05-25 round-3): **105 ✅ DONE** + **18 ⚠️ partial** (głównie smoke-only lub combat-sim subset — pełna lista w plikach) + **~11 ⬜ TODO**. Z 134 unikalnych items w spec: **84% fully done, 89% pokryte minimum smoke-em**. **Round-2 cleanup batch (6 tests on SECONDARY account)**: 5.6 market create-listing (UI + DB row verification), 5.13 offline-hunt full-bag invariant, 5.14 offline-hunt task progression, 6.11 item-upgrade system-chat broadcast, 7.6 monster-list task highlight, 10.2 full alchemy craft. **Round-3 batch (3 tests on SECONDARY)**: 3.4 representative `shop/elixirs/atk-damage-elixir-works-in-combat.spec.ts` (one elixir end-to-end through SKIP combat; remaining E×N elixir variants covered by combatElixirs.test.ts unit suite); 11.5 synthetic `auto-potion/with-cooldown-reducing-equipment.spec.ts` (current contract pinned — potion cooldown is locked at 1000ms baseline; no item or buff mechanism exists yet to reduce it; future-proof regression guard); 15.2 pragmatic `offline/online-toggle-mid-combat-finalizes-correctly.spec.ts` (stages `phase=fighting` offline + toggles online + asserts state survives + SKIP-resolves to victory + rewards persist). **Round-4 batch (4 advanced combat tests on PRIMARY)** sesja 2026-05-25: 13.6 `combat/auto-potion/combo-with-auto-spell-no-stutter.spec.ts` (single tick `doPlayerAttackTick` runs basic attack → auto-skill `shield_bash` → auto-potion all back-to-back; asserts no crash + skill dmg applied + MP consumed + HP healed via auto-potion); 13.14 `combat/multi-context/animations-sync.spec.ts` (multi-ctx bidirectional `publishSpellCast` test: primary publishes → secondary receives + vice versa, plus per-caster keying contract so two sequential casts don't collide); 13.15 `combat/aggro/correct-on-member-leave.spec.ts` (simulate 2-human party via `partyStore.setState` → `removeMember` mid-fight → asserts `iAmLeader` pool-widening flips off + no crash + phase still fighting + setWaveMonsterAggro writes still work); 13.23 `combat/death/no-resurrect-after-victory.spec.ts` (`triggerPlayerDeath` → death penalty applied → force `setPhase('victory')` → asserts penalty PERSISTS through victory transition: level=49 + xp=0 + hp=max all unchanged after victory, no phantom revive). Pozostałe ⬜ items wymagają dedykowanej infry: transform expiry sim, market BUY multi-context UI flow, offline-hunt combat flow integration + floating chat icon multi-channel send. Większość pokrycia funkcjonalności = HIGH (most user-visible flows are tested), kombinatorial gaps = LOW priority (cherry-picked representative tests sufficient).

## Konta testowe (2026-05-24)

Mamy **dwa rodzaje** kont:

### 1. Stałe konta (login, character flow, gra)

Właściciel utworzył w Supabase Auth — testy ich NIE kasują, NIE
rejestrują. Te konta są seed-em — istnieją na zawsze.

| Konto | Użycie |
|---|---|
| **primary** (`test@grimshade.pl`) | Single-user scenariusze: login, character flow, combat solo, inventory, quests |
| **secondary** (`test2@grimshade.pl`) | Multi-context (party, Realtime, chat, PM) — łączymy z primary w jednym `.spec.ts` przez `browser.newContext()` × 2 |

### 2. Ulotne konta (registration tests)

Tylko dla testów które MUSZĄ przechodzić przez prawdziwy flow rejestracji.
Wzorzec:

| Krok | Co |
|---|---|
| Generujemy email | `generateTestEmail()` → `e2e-register-{ts}-{rand}@grimshade-test.local` |
| Test rejestruje | Wypełnia formularz, klika "Zarejestruj się", asercje |
| `afterEach` cleanup | `cleanupTestUserByEmail(email)` — hard-delete z `auth.users` + child tables |

Pattern w pliku `tests/e2e/auth/register/redirect-on-success.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { generateTestEmail, cleanupTestUserByEmail } from '../../fixtures/cleanup';

test.describe('Auth › Register', { tag: '@auth' }, () => {
    test('happy path: valid signup → /character-select', async ({ page }) => {
        const email = generateTestEmail();
        try {
            // ... wypełnij formularz, tap submit, asercje
        } finally {
            await cleanupTestUserByEmail(email);
            // try/finally per-test ZAMIAST moduł-level array + afterEach —
            // bo `fullyParallel: true` może odpalić wiele tests z jednego
            // pliku równocześnie, a shared array tworzy race condition.
        }
    });
});
```

**Safety net**: `cleanupTestUserByEmail()` rzuca `Error` jeśli email NIE
matchuje patternu `e2e-register-*@grimshade-test.local`. Oznacza to że
nawet bug w teście (np. pomylkowy `test@grimshade.pl`) nie skasuje
realnego konta.

**Bulk safety-net cleanup**: `cleanupAllRegistrationTestUsers()` — leci
przez wszystkich userów z domeną `@grimshade-test.local` i kasuje
matchujące pattern. Użyteczne jako CI cron (TODO: dorzucić workflow)
i lokalnie żeby zacząć od czystego stanu po failed afterEach.

### 3. Charactery na stałych kontach — ZAWSZE kasowane po teście (2026-05-25)

**Hard rule** (CLAUDE.md TESTING): żaden test E2E nie zostawia po sobie
postaci na `test@grimshade.pl` ani `test2@grimshade.pl`. Ani na localu,
ani na produkcji. Postać utworzona w teście MUSI zniknąć.

Sposoby tworzenia postaci w testach:

| Pattern | Kiedy używać |
|---|---|
| **UI flow** przez `/create-character` | Tylko gdy testujemy SAMO tworzenie postaci (`tests/e2e/character/create/*`). Wolne, ale realny end-to-end. |
| **`createCharacterViaApi`** seed | Wszystko inne — shop, combat, inventory, social, … Postać tworzona przez service_role INSERT, deterministyczna, szybka. |

W obu przypadkach cleanup leci tak samo — przez `cleanupCharactersForEmail`.

Pattern dla testu który potrzebuje świeżej postaci na primary account:
```ts
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharactersForEmail } from '../../fixtures/cleanup';

test.describe('Inventory › Equip', { tag: '@inventory' }, () => {
    test('equipping sword updates attack stat', async ({ page }) => {
        const charName = generateTestCharacterName();
        try {
            // Seed: stwórz postać przez API bezpośrednio (szybkie, deterministyczne)
            await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: charName,
                class: 'Knight',
            });

            // Login + flow przez UI
            await loginViaUI(page, testUsers.primary);
            // ... wybierz postać, otwórz inventory, equip, asercja
        } finally {
            // ZAWSZE kasujemy WSZYSTKIE postacie usera — nawet jak test crashował
            // przed wejściem do try. cleanupCharactersForEmail jest idempotent.
            await cleanupCharactersForEmail(testUsers.primary.email);
        }
    });
});
```

**Safety net**: `cleanupCharactersForEmail()` rzuca `Error` jeśli email
nie jest w `STABLE_TEST_ACCOUNTS` (`test@grimshade.pl` / `test2@grimshade.pl`).
Pomyłkowy email = test wybucha, nie kasuje danych realnemu graczowi.

**Co cleanup kasuje**:
- `characters` (wszystkie postacie usera)
- `inventory` (wszystkie itemy postaci)
- `game_saves` (snapshoty offline)
- `character_skills`, `character_weapon_skills` (skille + weapon skille)
- `character_deaths`, `character_death_totals` (śmierci → znikają z deaths feed)
- `party_members`, `guild_members`, `guild_join_requests` (członkostwa)
- `guild_boss_attempts`, `guild_boss_contributions`, `guild_treasury_logs` (guild kontrybucje)
- `market_listings`, `market_sale_notifications` (oferty na markecie)

**Rankingi** — Leaderboard.tsx czyta z `characters` table direct, więc
delete postaci usuwa ją z każdego rankingu automatycznie (bez osobnego
cleanup).

**`messages`** (chat) — używa `user_id`, NIE `character_id`, więc cleanup
postaci tego NIE rusza. Wiadomości testowe zostają w chat history na
zawsze. Jeśli to staje się problem (spam w chacie produkcyjnym), wtedy
dorzucimy osobny cleanup hook na `messages WHERE user_id = ?` (ale dla
stałych kont to OK — to one same wysłały wiadomości).

### Setup credentiali

1. Skopiuj template:
   ```bash
   cp .env.test.example .env.test
   ```
2. Wpisz hasła do `.env.test` (właściciel je zna; plik gitignored).
3. Na CI — credentiale wstrzykuje GitHub Actions z Secrets (TODO: dorzucić
   `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` / `E2E_USER2_EMAIL` /
   `E2E_USER2_PASSWORD` do repo Secrets).

### Użycie w teście

Plik `tests/e2e/auth/login/redirect-on-success.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';

test.describe('Auth › Login', { tag: '@auth' }, () => {
    test('happy path: valid credentials → /character-select', async ({ page }) => {
        await page.goto('/login');
        await page.locator('input[type="email"]').fill(testUsers.primary.email);
        await page.locator('input[type="password"]').fill(testUsers.primary.password);
        // .tap() na mobile profile = prawdziwy touchstart/touchend
        await page.getByRole('button', { name: /zaloguj/i }).tap();
        await expect(page).toHaveURL(/\/character-select/);
    });
});
```

Multi-context:
```ts
test('party member sees leader combat', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    await loginAs(await ctx1.newPage(), testUsers.primary);
    await loginAs(await ctx2.newPage(), testUsers.secondary);
    // … party flow, asercje na obu kontekstach
});
```

## Setup state — szybciej niż klikanie przez UI

Atomic testy NIE klikają sobie przez UI do żądanego state (np. "zaloguj
się, stwórz postać, idź do walki, atakuj") — to wolne i kruche. Wzorce:

1. **Login raz, reuse session** — Playwright `storageState` cache-uje
   cookie + localStorage po pierwszym loginie, reszta testów startuje
   "już zalogowana" (helper TODO w `fixtures/`).
2. **Direct API seed** — Supabase REST/RPC do dosypania character +
   state ZANIM test odpali browser (helper TODO w `fixtures/`).
3. **localStorage / sessionStorage injection** — `page.addInitScript`
   wkleja gotowy state przed pierwszą nawigacją.

## Struktura folderu (3-poziomowa hierarchia)

Standard 2026-05-24: zamiast jednego płaskiego `auth/` z 4-5 spec-ami
dla różnych ekranów (Login / Register / Forgot Password), robimy
**3 poziomy zagłębienia**:

```
tests/e2e/
├── README.md                                 ← ten plik
├── fixtures/                                 ← shared helpers (płaski folder, nie segregujemy)
│   ├── testUsers.ts                          (DONE) typed access do stałych test accounts
│   ├── cleanup.ts                            (DONE) hard-delete registration test users
│   ├── login.ts                              (DONE) login via UI + redirect wait
│   ├── createCharacter.ts                    (DONE) direct API character seed
│   ├── seedGameSave.ts                       (DONE) game_saves blob seeder (gold/consumables/buffs/friends/masteries/skills)
│   ├── seedInventory.ts                      (DONE) bag/equipment/consumables/stones seeders
│   ├── seedDeath.ts                          (DONE) character_deaths seed for /deaths feed tests
│   ├── seedWeaponSkill.ts                    (DONE 2026-05-25 round-5) character_weapon_skills DELETE+INSERT for weapon-skill ranking tests (Sword / MLVL / Boss / Dagger / Dist / Bard / Shield)
│   ├── seedQuestState.ts                     (DONE) quest store slice seed
│   ├── seedGuild.ts                          (DONE) direct INSERT into guilds + guild_members
│   ├── guildCleanup.ts                       (DONE) delete guilds by leader_id (CASCADE child rows)
│   ├── multiContext.ts                       (DONE) parallel login of primary + secondary browser ctx
│   ├── adminClient.ts                        (DONE) shared Supabase admin SDK (cached per worker)
│   └── combatSim.ts                          (DONE 2026-05-25) combat-sim helpers — `runCombatViaSkip` (SKIP-resolve fight), `killMonsterViaEngine` (full reward flow), `triggerPlayerDeath` (direct death-penalty trigger), `getCombatSnapshot` + `getCharacterSnapshot` (state assertions)
│
├── auth/                                     ← AREA (= tag @auth)
│   ├── login/                                ←   SUBAREA (= describe 'Auth › Login')
│   │   ├── page-loads.spec.ts                (smoke)
│   │   └── redirect-on-success.spec.ts       (happy path)
│   ├── register/                             ←   SUBAREA (= describe 'Auth › Register')
│   │   └── redirect-on-success.spec.ts
│   └── forgot-password/                      ←   SUBAREA (= describe 'Auth › Forgot Password')
│       └── endpoint-success.spec.ts
│
├── character/                                ← AREA (TODO)
│   ├── select/
│   │   ├── lists-existing-characters.spec.ts
│   │   └── picks-one-and-enters-town.spec.ts
│   └── create/
│       ├── shows-all-7-classes.spec.ts
│       └── creates-character-and-redirects.spec.ts
│
├── combat/                                   ← AREA (TODO)
│   ├── attack/
│   │   ├── deals-damage.spec.ts
│   │   └── crit-applies-multiplier.spec.ts
│   ├── potion/
│   │   ├── restores-hp.spec.ts
│   │   └── disabled-when-empty.spec.ts
│   └── death/
│       ├── triggers-overlay.spec.ts
│       └── applies-xp-penalty.spec.ts
│
├── inventory/                                ← AREA (TODO)
│   ├── equip/
│   ├── upgrade/
│   └── sell/
│
└── party/                                    ← AREA (TODO, multi-context)
    ├── invite/
    └── combat-sync/
```

**Reguły hierarchii:**

| Poziom | Co | Przykład |
|---|---|---|
| 1 (area) | folder = area gameplay-owa + tag `@<area>` | `auth/`, `combat/`, `inventory/` |
| 2 (subarea) | folder = ekran / feature / story | `login/`, `register/`, `attack/`, `upgrade/` |
| 3 (scenario) | plik `.spec.ts` = JEDEN konkretny scenariusz | `page-loads.spec.ts`, `redirect-on-success.spec.ts`, `deals-damage.spec.ts` |

**Naming files (poziom 3)** — folder daje już cały kontekst, więc nazwa
pliku jest krótka i scenariusz-owa:

| Pattern | Przykład | Co testuje |
|---|---|---|
| `page-loads.spec.ts` | `auth/login/page-loads.spec.ts` | smoke — wyrenderowała się strona |
| `<outcome>-on-success.spec.ts` | `auth/login/redirect-on-success.spec.ts` | happy path z asercją |
| `rejects-<reason>.spec.ts` | `auth/login/rejects-invalid-creds.spec.ts` | error path |
| `<action>-<outcome>.spec.ts` | `combat/potion/restores-hp.spec.ts` | action z bezpośrednim efektem |
| `endpoint-success.spec.ts` | `auth/forgot-password/endpoint-success.spec.ts` | API endpoint health check |

**Co NIE zmieniamy:**

- `fixtures/` jest płaski — helpery są shared cross-area, sztuczne
  zagłębianie utrudnia import-y. Jeśli kiedyś będzie 30+ fixtures,
  rozważymy `fixtures/auth/`, `fixtures/combat/` etc.
- Import path z deep file: `../../fixtures/...` (2 levels up). Jeśli
  kiedyś będzie 4-level zagłębienie, to `../../../fixtures/...` —
  alternatywnie skonfigurujemy `tsconfig` paths alias `@e2e/fixtures/*`.

## Multi-context (party / Realtime testing)

Playwright pozwala odpalić 2+ niezależne browser-konteksty w jednym
teście. Tak testujemy WebSocket / Supabase Realtime flow.

### Helper: `openMultiContext(browser)`

Plik [`fixtures/multiContext.ts`](fixtures/multiContext.ts) ogarnia
boilerplate: spinuje 2 mobile-profile contexty w parallel, paralel-loguje
primary + secondary, i daje cleanup który zamyka oba contexty + nuke-uje
characters i `parties` rows (no FK na `leader_id` → muszą być osobno
delete'owane).

```ts
import { openMultiContext } from '../../../fixtures/multiContext';
import { createCharacterViaApi, generateTestCharacterName } from '../../../fixtures/createCharacter';
import { testUsers } from '../../../fixtures/testUsers';

test.describe('Social › Party', { tag: '@party' }, () => {
    test.describe.configure({ timeout: 120_000 }); // multi-ctx = slow

    test('primary creates party → secondary joins → both rosters sync', async ({ browser }) => {
        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            // 1. Seed characters BEFORE opening contexts (so pickers find them).
            primaryCharId = (await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: generateTestCharacterName(),
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            })).id;
            secondaryCharId = (await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: generateTestCharacterName(),
                class: 'Mage',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            })).id;

            // 2. Open both contexts + parallel login.
            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;
            // ... pick characters, navigate, action on primary, assertion on secondary
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            }
        }
    });
});
```

**Hard rules** (CLAUDE.md TESTING + 2026-05-25 multi-ctx session):
- 120s timeout (`test.describe.configure({ timeout: 120_000 })`) bo 2×
  login + Realtime waits sumują się szybko.
- Cleanup MUSI nuke oba accounts. `multiContext.cleanup({ primaryCharId, secondaryCharId })`
  ogarnia: (a) `parties` rows where `leader_id IN (primaryCharId, secondaryCharId)`,
  (b) characters + child rows via `cleanupCharacterById`, (c) browser
  context close. Bez kroku (a) party rows zostają w public feed bo
  `parties.leader_id` nie ma FK constraint → nie cascade-uje.
- Action na jednym page-u → assertion na DRUGIM. Single-context test
  z definicji nie sprawdza Realtime — dla "primary widzi to co secondary
  zrobił" musi być multi-ctx (np. test 4.2 assertuje `2/4 graczy` na
  primaryPage po secondary's tap-ie "Dołącz" — to JEDYNE udowodnienie
  że Realtime broadcast działa).
- Wait-for-enabled na buttons z `disabled={loading}` (Party.tsx 299/316/619)
  — `loading` flag jest shared między `refreshPublicParties` i submit btn,
  można złapać formę z wciąż-disabled-submit jeśli refresh's network
  call jeszcze nie wrócił. Patrz `with-password.spec.ts` step 6.

Realtime testy używają **prawdziwego Supabase** (tak samo jak single-ctx
testy). Pozostałe E2E też uderzają w prawdziwy Supabase (nie mock-ujemy
przez `page.route()` — sprzeczne z duchem E2E i ukrywa bugi RLS / Realtime
sub config).

## Uruchamianie — szybki cheatsheet

```bash
npm run test:e2e                                              # headless, cały suite na obu mobile profilach
npm run test:e2e:ui                                           # interactive UI mode (rekomendowane do oglądania)
npx playwright test --headed                                  # cały suite z widocznymi oknami przeglądarki
npx playwright test --project=mobile-safari --headed          # tylko iPhone 13 / WebKit, widoczne okno
npx playwright test auth/                                     # cała area auth (wszystkie subareas)
npx playwright test auth/login/                               # tylko subarea login
npx playwright test auth/login/redirect-on-success --debug    # konkretny scenariusz, step-by-step
npx playwright test --grep "@auth"                            # cross-file filter po tagu
npx playwright show-report                                    # HTML report z trace + screenshots + video po ostatnim run-ie
npx playwright show-trace test-results/.../trace.zip          # otwórz konkretny trace plik
```

## Jak zobaczyć testy "na własne oczy" — 4 metody

| Metoda | Komenda | Kiedy używać |
|---|---|---|
| **UI Mode** (rekomendowane) | `npm run test:e2e:ui` | Otwiera GUI Playwright-a — lista testów po lewej, podgląd przeglądarki + DOM po prawej. Możesz wybierać testy, klikać "play", widzieć time-travel każdej akcji (hover na step → screenshot z tego momentu). Najlepsze do oglądania jak testy faktycznie klikają / tapują w aplikacji. |
| **Headed mode** | `npx playwright test --headed` | Odpala test normalnie ale browser-okno jest WIDOCZNE — patrzysz na żywo jak Chromium/WebKit klikają. Szybko leci (~1-2s na test). |
| **Single test headed + slow** | `npx playwright test auth/login/redirect-on-success --headed --project=mobile-safari --workers=1` | Jeden test, jedno okno iPhone-emulacji, spokojnie. Najlepsze do "wytłumacz mi co robi ten test". |
| **HTML report po failu** | Run → `npx playwright show-report` | Po każdym test runie generuje się HTML w `playwright-report/`. Otwiera w przeglądarce listę pass/fail + per-test screenshot + video + trace (klik = time-travel debugger). |

Trace viewer (`show-trace`) jest najpotężniejszy — pokazuje DOM snapshot w każdym kroku, network requests, console logs, video, screenshot. Po każdym fail Playwright zapisuje `trace.zip` w `test-results/...`.

## Aktualne projekty (mobile-only, 2026-05-24)

```
mobile-safari   → iPhone 13 / WebKit  (390×844, hasTouch, isMobile)
mobile-chrome   → Pixel 7  / Chromium (412×915, hasTouch, isMobile)
```

Desktop został świadomie pominięty — Grimshade jest aplikacją mobilną PWA, tap event ≠ mouse click. Jeśli kiedyś chcemy desktop coverage, dorzucamy osobny suite (oddzielne pliki z `.click()` zamiast `.tap()`).

## Konwencja: nazwy plików + grupowanie (CRITICAL — 2026-05-24)

Przy 50+ testach flat lista w UI Mode jest niemożliwa do nawigacji.
**Każdy `.spec.ts` MUSI być wrapped w `test.describe()` z tagiem area-owym** —
to daje hierarchię w UI Mode + filtrowanie po tagach across files.

### Format (3-poziomowa hierarchia)

| Poziom | Co | Wartość | Przykład |
|---|---|---|---|
| **L1 folder** | area gameplay-owa | `tests/e2e/<area>/` | `auth/`, `combat/`, `inventory/` |
| **L2 folder** | ekran / feature / story w obrębie area | `tests/e2e/<area>/<subarea>/` | `auth/login/`, `auth/register/`, `combat/attack/` |
| **L3 plik** | JEDEN scenariusz | `<scenario>.spec.ts` | `page-loads.spec.ts`, `redirect-on-success.spec.ts`, `deals-damage.spec.ts` |
| **Top-level describe** | label dla UI Mode + asercje | `'<Area> › <Subarea>'` | `'Auth › Login'`, `'Combat › Attack'`, `'Inventory › Upgrade'` |
| **Tag na describe** | filtr cross-file | `{ tag: '@<area>' }` | `{ tag: '@auth' }` — filtruje cały area w UI Mode + CLI |
| **Test name** | krótkie zdanie EN | (describe daje kontekst) | `'happy path: valid credentials → /character-select'` |

Separator `›` (Unicode chevron) w describe — wizualnie sugeruje path
hierarchy. **Folder L1 + L2 musi się zgadzać z describe**: jak folder
to `auth/login/` → describe MUSI być `'Auth › Login'`. To pozwala
crosslink-ować "ten test który widzę w UI Mode" z "ten plik na disku".

### Przykład kanoniczny

Plik `tests/e2e/auth/login/redirect-on-success.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';  // 2 levels up — głębokie zagłębienie

test.describe('Auth › Login', { tag: '@auth' }, () => {
    test('happy path: valid credentials → /character-select', async ({ page }) => {
        await page.goto('/login');
        // ...
    });

    // Atomic principle: jeśli kolejny scenariusz Login (np. invalid creds,
    // malformed email) jest INDEPENDENT → osobny plik w tym samym
    // folderze: `auth/login/rejects-invalid-creds.spec.ts` z tym samym
    // describe `'Auth › Login'`. Wiele tests w jednym describe tylko gdy
    // dzielą setup który jest dosłownie identyczny.
});
```

### Co to daje w Playwright UI Mode

Płaska struktura (`auth/*.spec.ts` bez subfolderów + bez describe — ŹLE):
```
TESTS
> forgot-password-endpoint-responds.spec.ts
  > endpoint forgot-password odpowiada...
> login-page-loads.spec.ts
  > login page renders email + password...
> login-success-redirects-to-character-select.spec.ts
  > user loguje się prawidłowymi credentials...
```

3-poziomowa hierarchia (folder L1 + L2 + describe — DOBRZE):
```
TESTS
> auth/
  > forgot-password/
    > endpoint-success.spec.ts
      > Auth › Forgot Password
        > endpoint responds with success on valid email submit
  > login/
    > page-loads.spec.ts
      > Auth › Login
        > smoke: login page renders email + password form
    > redirect-on-success.spec.ts
      > Auth › Login
        > happy path: valid credentials → /character-select
  > register/
    > redirect-on-success.spec.ts
      > Auth › Register
        > happy path: valid signup → account exists → /character-select
```

Playwright UI Mode zwija foldery do drzewa — klik na `auth/` rozwija
3 subfoldery, klik na `login/` rozwija 2 testy, klik na test → uruchom
+ time-travel.

Plus cross-file filtering po tagu:
```bash
npx playwright test --grep "@auth"                # tylko auth area
npx playwright test --grep "@auth" --grep-invert "smoke"  # auth bez smoke testów
```
W UI Mode: pole search "@auth" filtruje listę.

### Per-area tagi + subfoldery (źródło prawdy — uzupełniamy gdy dodajemy area)

| Area (L1) | Tag | Folder L1 | Subareas (L2) — przykład rozbicia |
|---|---|---|---|
| **Auth** | `@auth` | `tests/e2e/auth/` | `login/`, `register/`, `logout/`, `forgot-password/`, `session/` (DONE 2026-05-25: 15.1 `expiry-redirects-to-login.spec.ts` — wipe `sb-*` localStorage → goto /inventory → ProtectedRoute redirects to /login) |
| **Character** | `@character` | `tests/e2e/character/` (TODO) | `select/`, `create/`, `delete/` |
| **Combat** | `@combat` | `tests/e2e/combat/` | `hunting/` (DONE: 13.5 smoke `page-loads.spec.ts` + **NEW 2026-05-25 combat-sim era**: 13.5 reward-flow SKIP `full-kill-rewards-xp-and-gold.spec.ts`, 13.5 reward-flow LIVE `kill-awards-gold-and-runs-reward-flow.spec.ts`, 13.12 kill counter `kill-counter-increments-per-kill.spec.ts`, 13.13 logs `combat-log-captures-kill-entries.spec.ts`), `boss/` (DONE: 13.5 smoke `page-loads.spec.ts`), `transform/` (DONE: 13.5 smoke `page-loads.spec.ts` + **NEW 2026-05-25**: 13.19 `completion-grants-reward.spec.ts` — direct transformStore actions drive start→defeat 30 monsters→complete→claim, proves `pendingClaimTransformId` DC safeguard + final `completedTransforms` array push), `dungeon/` (DONE 2026-05-25: 13.5 smoke `page-loads.spec.ts` + **NEW 2026-05-25**: 13.16 `min-level-rule.spec.ts` — solo Knight lvl 5, dungeon_10 (minLvl=10) shows `.dungeon__locked` chip + no `.dungeon__enter-btn`; dungeon_1 (minLvl=1) shows enter btn. Party variant TODO multi-context), `trainer/` (DONE 2026-05-25: 13.5 smoke `page-loads.spec.ts`), `arena/` (DONE 2026-05-25: 13.5 smoke `page-loads.spec.ts` + **NEW 2026-05-25**: 13.18 `correct-rewards.spec.ts` — finalizeMatch attacker-down win → inventoryStore.arenaPoints+=100, competitor seasonAp+=100, leaguePoints+=1, matchLog+=1, matchesWon+=1. Loss variant TODO), `raid/` (DONE 2026-05-25: 13.5 smoke `page-loads.spec.ts` — solo no-party gate), `loot/` (**NEW 2026-05-25**: 13.17 `full-inventory-bag-counter.spec.ts` — seed 1000 filler items + `killMonsterViaEngine(rat)` → asserts bag stays at MAX_BAG_SIZE=1000 post-overflow + gold/XP delta > 0. Proves engine's `addItem` overflow-swap branch never grows bag past max — load-bearing crash-prevention assertion), `ui/` (**NEW 2026-05-25**: 13.25 `clickability-at-each-speed.spec.ts` — idle hub cycle speed chip x1→x2→x4→SKIP→x1 (4 taps), after each assert label flipped + sibling skill-mode + auto-fight chips still tappable. 5-attempt retry loop with `force:true` + 200ms pre-tap delay handles mobile-chrome touch race + iOS double-tap zoom), `flee/` (DONE 2026-05-25: 13.24 atomic `feed-shows-seeded-flee.spec.ts` — seeded fled row → /deaths verb "przegnał"; **NEW 2026-05-26**: 13.24 solo `solo-stops-combat-preserves-character.spec.ts` (stage fight + `stopCombat()` → phase=idle + HP saved from combat state + level/xp/bag UNCHANGED — SOFT HUNT-flee contract, distinct from heavy `applyCombatLeaveDeath` dungeon-leave path), 13.24 party multi-ctx `party-leader-flee-broadcasts-combat-end.spec.ts` (Knight+Mage party 2/4 → leader `stopCombat` fires `publishCombatEnd` → secondary `lastCombatEndAt` advances within 45s window)), `death/` (DONE 2026-05-25 — armed-state SMOKE trio: 13.20 `no-protection-shows-no-buff-chip.spec.ts` (negative — no consumables → `.top-header__buffs-btn` count=0 → pre-condition: full XP/EQ penalty will apply on real death), 13.21 `aol-armed-shows-buff-row.spec.ts` (seed `amulet_of_loss:3` → TopHeader chip + `.buff-popover__row--protection` "Amulet of Loss" + `×3`), 13.21 `death-protection-armed-shows-buff-row.spec.ts` (seed `death_protection:2` → analog row "Eliksir ochrony" + `×2`, plus negative assert że AOL row NIE renderuje się gdy aolCount=0 — regression guard przeciw skopiowanym branch-om w BuffPopover.tsx line 106/115); **NEW 2026-05-25 combat-sim era × 2**: 13.20 full penalty `real-death-applies-xp-penalty.spec.ts` (Knight lvl 50 → triggerPlayerDeath → level=49, xp=0, hp=max), 13.21 DP consume `death-protection-prevents-level-loss.spec.ts` (Knight lvl 50 + 2× death_protection → trigger → level UNCHANGED, count=1, hp=max), **NEW round-4 2026-05-25**: 13.23 `no-resurrect-after-victory.spec.ts` (`triggerPlayerDeath` → death penalty applies (level 50→49, xp=0, hp=max) → force `useCombatStore.setPhase('victory')` → asserts level/xp/hp/max_hp ALL unchanged after victory — proves victory transition is purely state, doesn't undo death penalty; pairs with 13.20 to cover full "death-during-victory" contract). Resurrect (13.22) blocked on multi-ctx combat-sim.), `auto-potion/` (**NEW 2026-05-25 combat-trigger trio**: 11.2 `triggers-on-hp-threshold-via-engine.spec.ts` (HP 33% < 50% threshold → `engine.tryAutoPotion` fires hp_potion_sm via `useConsumable`, HP +50, cooldown set, log line written), 11.3 `combo-flat-and-pct-hp-both-fire.spec.ts` (enable pct slot via `setAutoPotionPctHpEnabled(true)`, HP 25% triggers BOTH flat + pct in single engine tick — two consumables decrement, HP +74 combined, both cooldown buckets engaged, 2 log entries), 11.x `does-not-fire-above-threshold.spec.ts` (negative regression — HP 66% > 50% threshold → ALL three side effects unchanged: count + HP + cooldown all preserved). Tests drive `engine.tryAutoPotion` directly via `page.evaluate` with `combatStore.initCombat(rat, ...)` staging — same code path real combat hits (combatEngine.ts line 1983 / 2324 / 2661 / 2750), just without the fragile real-time attack-cadence + auto-fight chain. **NEW round-4 2026-05-25**: 13.6 `combo-with-auto-spell-no-stutter.spec.ts` (cross-subsystem combo — seed Knight lvl 10 + shield_bash slotted + unlocked + 5× hp_potion_sm, stage HP=30/120=25% + monster rat HP=10000, clear all cooldowns including module-level skillCooldownMap via `advanceSkillCooldowns(1e9)`, invoke `engine.doPlayerAttackTick(false)` ONCE — production tick path runs basic attack → auto-skill cast block → auto-potion check sequentially, asserts NO crash + phase=fighting + BOTH systems fired: monster took damage + MP consumed ≥15 (shield_bash mpCost) + skill log entry + consumable -1 + HP rose + cooldown set + Auto-Potion log entry; load-bearing against order-of-operations regression where auto-potion reads stale combat state after skill cast)), `speed/` (**NEW 2026-05-25**: 13.7 partial `setting-persists-across-skip-fight.spec.ts` — proves `runCombatViaSkip` restore contract: pre-set `combatSpeed='x4'`, run SKIP fight, verify post-fight `combatSpeed === 'x4'` (NOT 'SKIP'). Load-bearing for every test that chains combat-sim ops; if broken every subsequent test silently inherits SKIP mode), `cooldown/` (**NEW 2026-05-25**: 13.8 derived `auto-potion-respects-cooldown-on-rapid-fire.spec.ts` — 3-fire sequence (fire #1 succeeds + sets cooldown → fire #2 immediately blocked by cooldown → `cooldownStore.tick(1000)` releases → fire #3 succeeds again). Catches `cd > 0` vs `cd >= 0` off-by-one + `startCdFn` not-called regressions), `party/` (**NEW 2026-05-25 multi-context combat era × 3**: 13.10 `spell-retargets-on-ally-kill.spec.ts` — multi-ctx party + 2-monster wave setup + simulate ally-killed-slot via `damageWaveMonster + markActiveWaveMonsterDead` + invoke `huntApplySkillEffectV2` directly → asserts `activeTargetIdx` flipped to next alive slot + mirrored monster fields synced + negative branch when no alive monsters returns null (cast refused, MP saved); 13.11 `each-player-gets-unique-rewards.spec.ts` — multi-ctx + parallel `applyMonsterKillRewardsForMember` on both pages → asserts both members got same `finalXp` (uniformity rule) + independent gold rolls + per-character sessionKills/task progress; 13.22 partial `ally-resurrect-broadcasts-through-channel.spec.ts` — Cleric→Knight Realtime `spell-cast` wire test for `resurrection_aura` + runtime `parseEffects`/`applyEffects` validation of `revive_party:0:0` → `reviveDeadAllies:true`. Gap: HP=0→>0 player-revival transition deferred (involves leader-in-multi-human-party HP=0 gate + handlePlayerDeath "wait for revive" state machine). 180 s timeout per task brief for multi-ctx combat); `multi-context/` (**NEW 2026-05-25 round-4**: 13.14 `animations-sync.spec.ts` — multi-ctx bidirectional `publishSpellCast` proof: PRIMARY publishes `shield_bash` → SECONDARY receives via `lastSpellByCaster[primaryId]` Realtime broadcast + PRIMARY's local mirror also populates (partyCombatSyncStore.ts line 977-980); reverse direction (SECONDARY publishes → PRIMARY receives) also asserted; final per-caster keying contract — BOTH casters' entries present on BOTH pages map simultaneously, proves the map key per `casterId` design so sequential casts from different members don't overwrite each other); `aggro/` (**NEW 2026-05-25 round-4**: 13.15 `correct-on-member-leave.spec.ts` — single-context per task brief: simulate 2-human party via `partyStore.setState` → `removeMember(secondaryId)` mid-fight → asserts (1) preLeave humanCount=1 + `iAmLeader` pool-widening armed (combatEngine.ts line 2050), (2) postLeave humanCount=0 + pool-widens=false (re-roll pool excludes `human_<id>` entries), (3) no crash during post-leave mutations, (4) `useCombatStore.setWaveMonsterAggro` still writable post-leave proves the wave-monster field accepts arbitrary string targets without corruption); `attack/`, `potion/` TODO. **NEW 2026-05-25 round-5**: `loch/` (DONE — 13.5 `page-loads.spec.ts` single-context smoke: pre-seed Knight lvl 10 on SECONDARY + 1-member guild via `seedGuild` → Town → Społeczność → Gildia → tap Loch nav tile → `.guild__boss-stage` + `.guild__boss-preview-img` + `.guild__boss-preview-hpbar` + `.guild__boss-info` all visible. Proves the full chain phase='boss' → GuildBoss mount → `fetchOrCreateWeeklyBoss` → boss row hydrated → JSX renders. Single-context sufficient — 1-member guild can fully render the Loch view; multi-member contribution flow already covered by 4.5); `elixirs/` (DONE 2026-05-25 — full HP/MP elixir consistency coverage on /combat: 3.5 `hp-pct-elixir-consistency-in-combat.spec.ts` (Knight + hp_pct_25 → 150 effective) + 3.6 `hp-flat-elixir-consistency-in-combat.spec.ts` (Knight + hp_boost_500 → 620 effective) + 3.10 `mp-pct-elixir-consistency-in-combat.spec.ts` (Mage + mp_pct_25 → 250 effective MP). Each asserts triple-source consistency: TopHeader popover textual reading + `engineGetEffectiveChar(character).max_hp/mp` engine helper + multiplier/bonus helper (`getElixirHpPctMultiplier`/`getElixirHpBonus`/`getElixirMpPctMultiplier`) all agree, then runs `runCombatViaSkip(page, 'rat')` to prove the buff propagates through the actual combat path without NaN-ing on Math.min HP/MP clamps. Guards against TopHeader/engine split-brain where UI shows one max and auto-potion / spell-MP-cost gating fires at a different threshold. SECONDARY account per suite contention; 90s timeout); `speed/` extended with `change-during-active-fight.spec.ts` — `useCombatStore.initCombat(rat)` stages phase='fighting' → `setCombatSpeed('x4')` mid-fight → asserts speed lands + phase stays 'fighting' + bidirectional cycle x4→x2→x1 works; proves the underlying setter has no phase-gated guard silently dropping mid-fight changes; chip-tap UI mechanics covered by 13.25, cadence timing by unit `combatCadence.test.ts`; `city/deaths/per-combat-type.spec.ts` (5.10) — parametrized for-of over 5 DB-supported `TDeathSource` values (monster/dungeon/boss/transform/raid); each test seeds 1 row + asserts `.deaths__item-badge` shows correct SOURCE_META.label + sanity on source_name/level/victim_level/verb; 'raid' gracefully skips on envs missing `deaths_migration.sql`. **Combat-sim fixture (`fixtures/combatSim.ts`)** powers all 6 prior 2026-05-25 tests + the 4 NEW combat-trigger / speed / cooldown specs above + the 13.17 full-inventory test: `runCombatViaSkip(page, monsterId)` sets `settingsStore.combatSpeed='SKIP'` + invokes `startNewFight` via dynamic-import (synchronous resolution via `resolveInstantFight` — no gold/drops, fast XP path), `killMonsterViaEngine(page, monsterId, rarity)` drives full `handleMonsterDeath` reward flow (gold + drops + level-up + tasks/quests/mastery), `triggerPlayerDeath(page, monsterId)` calls `handlePlayerDeath(forceConfirm=true)` directly (solo char, bypasses party-popup gate), plus snapshot helpers `getCombatSnapshot` / `getCharacterSnapshot` for assertion before/after. Atomic 90s timeout per `test.describe.configure`. Auto-potion tests reach further into engine internals via direct `engine.tryAutoPotion(curHp, maxHp, curMp, maxMp)` calls — same function the live combat tick uses, called under identical store preconditions; deterministic, no real-time race. Arena (13.18) + Transform (13.19) reward tests drive `useArenaStore.finalizeMatch` / `useTransformStore.completeTransform` directly — exercises production store actions without the RNG combat layer between them. |
| **Inventory** | `@inventory` | `tests/e2e/inventory/` | `equip/`, `filter/`, `sell/`, `disassemble/`, `compare/`, `upgrade/`, `auto-sell/`, `stats/` (DONE: 6.1 / 6.2 / 6.4 / 6.5 / 6.6 / 6.7 / 6.8 / 6.9 / 6.10 `upgrade/refund-on-sell.spec.ts` verified 2026-05-25 + 6.3 settings-toggle partial + 6.12 `equip/hp-equip-consistency-across-views.spec.ts` (3-view subset) + 6.13 `upgrade/hp-upgrade-consistency-across-views.spec.ts` (3-view subset) + 3.9 `stats/hp-attribute-consistency.spec.ts` (3-view subset) + **NEW 2026-05-25 MP analogue pair**: 3.10c `equip/mp-equip-consistency-across-views.spec.ts` (helmet `bonuses: { mp: 20 }` → Mage 200 → 220 effective, all 3 widoki) + 3.10d `upgrade/mp-upgrade-consistency-across-views.spec.ts` (helmet +3 z `bonuses: { mp: 20 }` → wciąż 220 bo mp NIE jest base stat dla helmet-a per `getBaseStatKeysForSlot('helmet')=['hp']` → upgrade nie aplikuje — regression guard); `stat-points/` spend-flow TODO) |
| **Stats** (Postać › 📊 Statystyki popup) | `@stats` | `tests/e2e/stats/` | flat — popup live w `/inventory` view (StatsPopupBody, `Inventory.tsx` ~1574-1801) ale logicznie osobny obszar; pliki `popup-*.spec.ts` bez sub-folderów. DONE: 8.0 base-stats / 8.1 partial EQ-only / **2026-05-25** 8.1 4-source `popup-aggregates-all-sources.spec.ts` (Max HP = base 120 + equipped helmet hp=20 + skill train max_hp=4 (×5 +20) + buff hp_boost_500 (+500) = 660 efektywne) + **NEW 2026-05-25 round-5** 8.1 5-source `popup-aggregates-with-transform.spec.ts` (dodaje transform jako 5-ty source — Knight + completedTransforms=[1]: flatHp=420 + hpPercent=4, math: 120+20+20+500+420 = 1080 raw × 1.04 = 1123 effMaxHp, breakdown 6 lines Baza/Eq/Trening/Eliksir/TF flat/TF %). **Krytyczny seed order**: `seedGameSave` MUSI PRZED `seedEquippedItem` bo seedGameSave overwrite-uje equipment do null; seedEquippedItem merguje swój item nad istniejącym state. **Transform CAVEAT**: `characterScope.ts` legacy migration force-flagi `bakedBonusesApplied=true` jeśli `localStorage[tibia_transform_migration_v1_<charId>]` brakuje → test ustawia marker via `page.addInitScript` PRZED character pick żeby migracja była pomijana (bonusy live, nie zbaked). **Fixture extension**: `seedGameSave.transforms` slot dodany. **Dokumentacja decyzji "6 sources → 5 distinct"**: spec wymienia upgrade + party-buff jako osobne źródła ale (a) upgrade jest częścią Eq przez `getTotalEquipmentStats.getUpgradedBaseStat` — pokryte przez test 6.13 `inventory/upgrade/hp-upgrade-consistency-across-views`; (b) party-buff (battle_cry party_attack_up:20:5000) jest combat-only — aplikowane przez `applySkillBuff` / `huntApplySkillEffectV2` w combatEngine tick, NIE w StatsPopupBody. StatsPopupBody ma 5 distinct sources: base/Eq/Trening/Eliksir/Transform — wszystkie 5 testowane. |
| **Progression** (Quests / Tasks / Daily missions / Mastery) | `@progression` | `tests/e2e/quests/` | `tasks/` (DONE: 7.1 `one-per-monster.spec.ts`, 7.3 `filters-narrow-list.spec.ts`, 7.6 `highlighted-in-monster-list.spec.ts`, **NEW 2026-05-25 combat-sim trio**: 7.2 `rarity-counts-correctly.spec.ts` — 4-phase test of `addKill` `monsterId` filter + `MONSTER_RARITY_TASK_KILLS` multiplier (normal=1/strong=3/epic=10 verified via three rarities → progress 0→0 spider/0→1/1→4/4→14), 7.4 `rewards-match-spec.spec.ts` — full claim flow with `killMonsterViaEngine` to bring rat_10 progress 9→10, `forceSaveAfterCombat` before nav (page.goto = full HTTP reload → stores re-hydrate from DB), `.tasks__active-row-claim` tap, asserts xp/gold deltas (+45 XP / +30 gold per `computeTaskRewards(rat, 10)`) — load-bearing: tasks.json reward values are RECOMPUTED at claim time via formula, NOT read from JSON, 7.5 `visible-in-header-during-combat.spec.ts` — 3-bucket TopHeader TaskBadge `--live` proof (pre-combat baseline no --live, stage `initCombat(rat)` → button flips to `--live`, dropdown row gets `--live` + LIVE tag span)), `quests/` (DONE: 7.7 `level-restricted.spec.ts`, 7.8 `multiple-active.spec.ts`, 7.9 `abandon.spec.ts`, 7.10 `claim-rewards.spec.ts`), `daily/` (DONE: 7.11 `take-and-complete.spec.ts`), `notifications/` (DONE: 7.12 `header-badge-on-complete.spec.ts`); `mastery/` TODO. Folder L1 = `quests/` (nie `progression/`) bo route w app to `/quests` + hub-tile 3-up; tag `@progression` przykrywa cały obszar w UI Mode. |
| **Party** (multi-context) | `@party` | `tests/e2e/social/party/` | `create/` (DONE: 4.1 `with-password.spec.ts` + 4.3 `from-town.spec.ts`), `join/` (DONE: 4.2 `from-secondary-account.spec.ts` multi-context); `elixirs/` (DONE 2026-05-25 — 3.5 `hp-pct-elixir-broadcasts-to-party-member.spec.ts` multi-context: primary's hp_pct_25 buff broadcasts via `usePartyPresence` → secondary's Town expanded party strip `.town__party-hp-text` for primary's row shows boosted effective `40/150` (vs raw 40/120 if broadcast stripped multiplier). Cross-checks `partyPresenceStore.byMember[primaryCharId].maxHp === 150` direct store read for independent payload verification. Note: primary's OWN row uses raw `character.max_hp` (Town.tsx line 488) — quirk, not bug, the test asserts the cross-member path which is the canonical "party consistency" contract. 180s timeout); `combat-sync/`, `leader-handover/`, `invite/` TODO. Folder L1 = `social/party/` (nie `party/`) bo cała Społeczność (Party / Gildia / Znajomi / Czat) siedzi pod `tests/e2e/social/` — Spec spec też je grupuje (BACKLOG sekcja 4 "Społeczność"). Multi-context tests (`join/`, `elixirs/`) używają `multiContext.ts` fixture (parallel login + parties cleanup). 120s timeout dla multi-ctx, 60s dla single. |
| **Guild** (multi-context) | `@guild` | `tests/e2e/social/guild/` | DONE 2026-05-25: 4.4 `create/create-and-disband.spec.ts` (single-context — seed 2M gp gold via `seedGameSave({ gold })` → tap Stwórz gildię modal → fill name+tag → submit → assert home banner → tap 🚪 leave → confirm "ostatnim członkiem" warning → disband → list re-renders → guild absent from listing); 4.7 `join-requests/accept.spec.ts` (multi-context — primary founds, secondary applies via 🤝 modal, primary opens Prośby tile with `(1)` counter, taps ✓ Przyjmij, both rosters show 2/cap members + secondary's home view hydrates to home on re-nav); 4.8 `chat/post-and-receive.spec.ts` (multi-context — pre-seed guild with both as members via `seedGuild`, primary writes unique message in `.chat__input`, secondary's chat row appears via Realtime within 30 s, secondary's `.chat__msg-name` shows primary's nick); 4.9 `kick/leader-kicks-member.spec.ts` (multi-context — pre-seed guild, primary taps ✕ on secondary's row → confirm → assert primary roster shrinks via Realtime with re-navigation fallback, secondary's `/guild` re-nav lands on list browser); **NEW 2026-05-25**: 4.5 `guild-boss/multi-member-contributes.spec.ts` (multi-context — both members hydrate boss view via UI navigation, then drive `guildApi.applyBossDamage` + `addContribution` + `logAttempt` via `page.evaluate` for deterministic damage (50k/30k) → verify `guild_boss_contributions` has 2 rows keyed per-character with correct `total_damage` + `guild_boss_state.boss_current_hp` decreased by sum + `guild_boss_attempts` has 2 rows + UI re-nav assertion that each member sees own contribution in `.guild__boss-info`); 4.6 `treasury/put-and-take.spec.ts` (multi-context — primary's bag pre-seeded with `sword_of_beginnings` legacy item via `seedGameSave({ bagItems })`, primary navigates Skarbiec → tap "Włóż →", secondary's vault column receives item within 20s via GuildTreasury 5s poll → tap "← Wyciągnij" → item lands in secondary's bag column, DB validation: `guild_treasury_items` empty + `guild_treasury_logs` has 2 rows deposit+withdraw with correct character attribution); `elixirs/` (DONE 2026-05-25 — 3.5 `hp-pct-elixir-consistency-on-guild-view.spec.ts` single-context: Knight + hp_pct_25 + pre-seeded solo guild via `seedGuild` → /guild lands on home view → TopHeader popover shows `40/150` + `engineGetEffectiveChar(character).max_hp === 150` (same helper Guild.tsx line 1120 uses for boss-fight HUD). Multi-context guild HP-visibility variant skipped: there's no equivalent of partyPresence broadcast for guild — `guild_members` table stores class/level/transform_tier but NOT HP, so cross-member HP visibility doesn't exist at the data layer; canonical guild consistency = local route-mount agreement which is what we assert. 90s timeout). Folder L1 = `social/guild/` (under social/ alongside party — matches BACKLOG sekcja 4 grouping). Multi-context tests use `multiContext.ts` fixture + `seedGuild.ts` fixture (direct INSERT into `guilds` + `guild_members`) + `guildCleanup.ts` fixture (deletes `guilds` rows by `leader_id` — CASCADE handles `guild_members` + boss + treasury + requests; optional `channelsToClean` arg wipes `messages` for guild chat channels). **Realtime caveat**: on mobile-chrome the guild channel's postgres_changes delivery can exceed 15 s when running the full guild suite back-to-back; kick test has a re-navigation fallback to keep it deterministic without weakening the assertion. **Treasury caveat**: legacy items (`sword_of_beginnings`, `wooden_mace`, etc. in `getLegacyItemInfo` map) resolve to proper Polish names via `getItemDisplayInfo` — plain `items.json` IDs like `iron_sword` lack a `_lvlX_` suffix AND aren't in the legacy map, so the UI falls back to raw itemId rendering. Seed legacy IDs when locator-by-name matters. **Boss caveat**: full UI combat (Atakuj bossa → claim arena → tick loop) is too brittle for E2E; hybrid drives the SAME `guildApi` calls the production combatEngine uses, deterministically. 120 s timeout for multi-ctx, 60 s for single-context; 180 s for the boss/treasury pair that involves multi-step UI nav + DB validation. |
| **Friends / Social** (multi-context) | `@social` | `tests/e2e/social/friends/` | DONE 2026-05-25 (multi-ctx all 3): 4.10 `add-friend.spec.ts` (rendering-only — UI add-flow blocked by RLS on `characters`, test seeds `friends.friends` via new `seedGameSave({ friends })` slot + verifies Friends view renders row), 4.11 `direct-message.spec.ts` (deep-link `/chat?pm=<nick>` → `openPm` creates PM tab on both sides → Realtime broadcast), 4.12 `block-and-unblock.spec.ts` (3-phase: before-block / during-block 12 s wait beyond delivery / after-unblock; block via `.chat__menu` portal, unblock via `/friends` Zablokowani tab + confirm modal). All use `multiContext.ts` fixture with 120 s timeout. **Cross-area note**: tag `@social` covers both Friends-domain tests (this folder) AND chat tests (`social/chat/`), since BACKLOG groups them under section 4 "Społeczność". |
| **Chat (multi-context Realtime)** | `@social` | `tests/e2e/social/chat/` | `city/` (DONE 2026-05-25: 4.13 `realtime-broadcast.spec.ts` — multi-ctx city chat broadcast: primary fills + sends, secondary receives via Supabase Realtime postgres_changes within 20 s, asserts sender attribution + level pill); `pm/` covered by `social/friends/direct-message.spec.ts` (4.11). 120 s timeout per multi-ctx convention. **Distinction from `@chat`**: this subtree is multi-context Realtime; `tests/e2e/chat/` is single-context (e.g. 15.8 level pill render). |
| **Chat / PM** (single-context) | `@chat` | `tests/e2e/chat/` | `city/` (DONE: 15.8 `level-pill-reflects-character-level.spec.ts` — `msg.character_level=25` DB seed → `.chat__msg-level` text=25 + title=Poziom 25); `pm/`, `party-channel/`, `unread-badge/` TODO. Note: multi-context Realtime broadcast tests live under `tests/e2e/social/chat/` with `@social` tag (see row above). |
| **Shop** (Sklep — gold-purchased items / potions / elixirs / arena tab) | `@shop` | `tests/e2e/shop/` | `buy/` (DONE: 3.1 / 3.2 / 3.3 / 3.12 + 15.3 `race-condition-rapid-clicks.spec.ts`), `elixirs/` (DONE: 3.5 `hp-pct-elixir-consistency-across-views.spec.ts` (3-view subset) + 3.6 `hp-flat-elixir-consistency-across-views.spec.ts` (3-view subset) + 3.13 `buff-shows-in-header.spec.ts` + **NEW 2026-05-25 MP elixir pair**: 3.10a `mp-pct-elixir-consistency-across-views.spec.ts` (Mage + buff `mp_pct_25` → 250 effective, all 3 widoki) + 3.10b `mp-flat-elixir-consistency-across-views.spec.ts` (Mage + buff `mp_boost_500` → 700 effective)); `buffs/`, `transforms/`, `arena/` TODO |
| **Market** (player-to-player trading) | `@market` | `tests/e2e/market/` (TODO) | `list/`, `buy/`, `cancel/` |
| **City** (Miasto: monster list / rest / deposit / market / deaths / rankings / offline-hunt) | `@city` | `tests/e2e/city/` | `monsters/` (DONE: 5.1 / 5.2 / 5.3 / 5.4 (3/4 filtrów) / + **NEW 2026-05-25** 5.4 `filter-tasked-only.spec.ts` — 4-ty filter "Tylko z taskiem / questem" → seeded `rat_10` active task → toggle → count=1 + sanity Szczur), `rest/`, `deposit/`, `deaths/`, `rankings/` (DONE: 5.11a-c oryginalne 3 (LVL/Mastery/Arena) + **NEW 2026-05-25 round-5 (+11 tests)** pokrycie pozostałych 3 z 4 source path-ów: characters columns simple (arena-killers / arena-victims / crit-dmg / item-upgrades / daily-quests), characters custom branch (market-sold / market-bought / dps-solo), weapon_skill (sword-fighting / magic-level — cross-class Knight + Mage), pseudo-weapon_skill (boss-score). Razem 14 testów pokrywa wszystkie 4 source path-y Leaderboard.tsx. Pozostałe ~16 kategorii (Dagger/Distance/Bard/Shield/AS/HP/MP/regen/DEF/Crit%/DPS Party/Gildie/Śmierci/etc.) to mechaniczne copy-paste. Wszystkie nowe testy na SECONDARY (suite running on primary). **Fixture extensions**: `createCharacterViaApi.overrides` +11 nowych keys (arena_kills/arena_deaths/crit_damage/quests_oneshot_done/quests_daily_done/market_items_sold/market_gold_earned/market_items_bought/market_gold_spent/item_upgrades_done/best_dps5_solo); NEW fixture `seedWeaponSkill.ts` (DELETE+INSERT do character_weapon_skills mirror prod-side strategy)), `offline-hunt/` (DONE: 5.12 smoke `page-loads.spec.ts` + **NEW 2026-05-25 round-2**: 5.13 `full-inventory-edge.spec.ts` (1000-bag claim via direct `claimOfflineHunt` after `startHunt + backdate startedAt 12h` → bag stays at MAX_BAG_SIZE + reward chain executed), 5.14 `advances-task.spec.ts` (claim → addKill bumps active rat_10 task `progress` past killCount=10, taskStore raw-accumulates without cap)); `market/` (DONE 2026-05-25 round-2: 5.6 `create-listing.spec.ts` — sell hp_potion_sm stack via UI: tap Sprzedawaj tab → tile → SellModal → fill price 100 → Wystaw → auto-switch to "Moje" tab + toast + DB-side service_role verifies `market_listings` row with kind='potion' price=100 quantity=1; market buy multi-context 5.7 TODO). **Fixture extension**: `createCharacterViaApi.overrides` rozszerzone o `mastery_points` / `arena_league` / `arena_league_points` keys w sesji 2026-05-25 (kolumny istnieją od leaderboard_migration.sql; spread conditional gdy override != undefined). |
| **Chrome** (Town / TopHeader / BottomNav / AvatarMenu) | `@chrome` | `tests/e2e/chrome/` | `avatar-menu/` (DONE: 15.5 — `language-switch.spec.ts`); `top-header/` (DONE 2026-06-21: `level-milestone-gold-shows-in-wallet.spec.ts` — seed Knight lvl 9 → drive `addXp(xpToNextLevel(9))` via page.evaluate → asserts the gold milestone (10×10000=1cc) lands in `inventoryStore.gold` (spendable wallet) NOT the vestigial `characters.gold` column, and TopHeader `.top-header__gold-value` shows the `cc` tier. Regression for "+1cc announced but never received"); `bottom-nav/`, `town-view/` TODO |
| **Admin** (Panel admina — gated overlay) | `@admin` | `tests/e2e/admin/` | flat — pliki bez sub-folderów. DONE 2026-05-26: 15.6 gate `panel-tabs-load.spec.ts` (non-admin session → avatar menu hides `.avatar-menu__item--admin` entry — proves AvatarMenu.tsx line 242 `isAdmin && (...)` security boundary). Full 9-tab smoke captured as `test.skip` block with pseudo-code in JSDoc — BLOCKED on owner decision for dedicated admin test account + `ADMIN_EMAILS` allow-list refactor in `AdminPanel.tsx` / `AvatarMenu.tsx`. AdminPanel.tsx re-checks session email itself (line 95-103) so `page.evaluate setAdminOpen(true)` bypass also returns null — gate is layered. |
| **Auto-Potion** (Postać › 🧪 Potion popup, 4 threshold panels) | `@auto-potion` | `tests/e2e/auto-potion/` | flat — popup live w `/inventory` view (Inventory.tsx ~3566-3812) ale logicznie osobny obszar; pliki bez sub-folderów (DONE: 11.1 `threshold-persists-across-popup-cycle.spec.ts`, 11.4 `settings-ui-renders.spec.ts`, 11.4b `all-four-sliders-update-independently.spec.ts` NEW 2026-05-25 — drag 4 sliders, verify independence). **Combat-trigger flow (engine-level)** lives under `combat/auto-potion/` z tagiem `@combat` — see Combat row above (3 NEW 2026-05-25 tests: positive threshold trigger, flat+pct combo, above-threshold negative). UI flow w trakcie real-time combat tick (HP-bar drains przez ataki → ostatnie `attackTick` widzi HP < threshold → auto-potion fires) nadal TODO; engine-level coverage is the contract guard. |
| **Training** (Postać › 📚 Trening Skilli popup) | `@training` | `tests/e2e/training/` | flat — popup live w `/inventory` view (TrainingPopupBody, Inventory.tsx ~1865-1957); pliki `active-*.spec.ts` bez sub-folderów (DONE: 9.1 smoke `active-skill-ui-renders.spec.ts`); level-up logic TODO |
| **Alchemy** (Potion conversion — 2nd tab in Potion popup) | `@alchemy` | `tests/e2e/alchemy/` | flat — Alchemia tab w Potion popup (Inventory.tsx ~3818-3898); receipts source `src/systems/potionConversion.ts`; pliki bez sub-folderów (DONE: 10.1 `level-gate.spec.ts`, 10.2 smoke `ui-renders.spec.ts`); craft flow TODO |
| **Offline** (offline mode, sync, snapshot) | `@offline` | `tests/e2e/offline/` | flat — pliki bez sub-folderów (mode toggle + route guard + snapshot contracts są atomic, nie wymagają grupowania). Describes: `Offline › Mode` (toggle / route-guard) + `Offline › Sync` (snapshot lifecycle / online-sync). DONE 2026-05-25: 14.1 `mode-toggle-flips-status-dot.spec.ts` (toggle + status dot), 14.1b `mode-blocks-party-route.spec.ts` (OnlineOnlyGuard contract test), 14.2 `snapshot-captures-pre-state-and-clears-on-sync.spec.ts` (snapshot lifecycle: capture pre-state → clear on sync success; sessionStorage anchor `grimshade.offlineSnapshot`; pragmatic anti-hack contract test — full duplicate-exploit reproduction TODO U/I), 14.3 `online-switch-syncs-offline-gold-change.spec.ts` (offline addGold survives online toggle and lands in `game_saves.state.inventory.gold` canonical row; uses page.evaluate dynamic-import of `/src/stores/inventoryStore.ts` + `saveCurrentCharacterStoresForce()` bypass for 4 s throttle deterministically). |
| **Skills** (active skill bar / Aktywne Skille popup / per-class kit data) | `@skills` | `tests/e2e/skills/` | DONE: 12.5 flat `smoke-per-class.spec.ts` (parametryzowane smoke E×7 nad 7 klasami — popup `/inventory` → Skille → asercja na slot --filled + card --equipped + Aktywny badge dla tier-1 spell-a per klasa); `upgrade/` subfolder (DONE 2026-05-25: 12.7 `system-chat-message.spec.ts` — seeded `[SYS]{...skillUpgrade...}` payload do `messages` table → /chat System tab → assert `.chat__msg-text--skill` row z `<strong>` skill name + `<strong>+10` + body /ulepszył\(a\)\s+skill/i + `.chat__msg-sys-icon` rendered; pragmatic skip of combat-trigger because rolling 5+ successful upgrades for milestone is flaky — randomization covered by skillStore unit tests); `animations/` subfolder (DONE 2026-05-25: 12.6 `solo-trainer-per-class.spec.ts` — parametryzowane E×7 nad 7 klasami w `/trainer`, każdy seeduje char lvl 5 + tier-1 spell w slot 0 + flag unlock, wyłącza `autoSkill` + `autoFight` chipy żeby trainer-tick auto-fire nie zjadł cooldown, tap-uje `button[aria-label="<skillId>"]` w `.combat-ui__action-bar`, asertuje overlay `.skill-anim--<category>` + `.skill-anim-emoji` na właściwej karcie — enemy dla damage/debuff casts, ally dla Bard `battle_hymn` pure buff — i waits for self-removal po `animData.duration` 600-1500 ms; `mode: 'serial'` żeby 7 tests nie hitowało 7-char limitu na primary account); `multi-context/` subfolder (DONE 2026-05-25: 12.6 `party-member-sees-ally-spell-cast.spec.ts` — multi-ctx smoke: both create party via UI + join, then `page.evaluate` na primary publishes `spell-cast` via `usePartyCombatSyncStore.publishSpellCast` (dokładnie ten sam call co `combatEngine.ts` line 414), poll secondary's `lastSpellByCaster[primaryCharId]` until expected `skillId` lands; reverse direction też verified — bidirectional channel proof. 120 s timeout. Pragmatic vs full in-combat DOM render: solo per-class proves DOM path, multi-ctx smoke proves wire path; chain transitively closed). Sub-foldery `<class>/`, `speed/` TODO gdy będą dochodzić scenariusze in-combat (12.8+). |
| **Character** (create / select / delete) | `@character` | `tests/e2e/character/` | `create/` (DONE 2026-05-25: 2.7 `rejects-duplicate-nickname.spec.ts` runtime-probe + skip-if-no-migration — full assertion path when `scripts/character_unique_nick_migration.sql` is applied: seed shared-nick char on secondary → primary `/create-character` → tap Knight + fill same nick → submit → assert URL stays + `.character-create__error` visible + primary has 0 chars with that nick); 2.8 `blocks-at-max-7.spec.ts`, 2.9 `back-button-discards.spec.ts`. 2.1-2.6 IN PROGRESS. `select/`, `delete/` TODO. |
| **PWA** (manifest + service worker emission) | `@pwa` | `tests/e2e/pwa/` | flat — build-artifact smoke (no Playwright browser actions). DONE 2026-05-25: 15.7 `build-manifest-and-sw.spec.ts` — invokes `npm run build` from inside test if `dist/` missing/stale (`statSync(MANIFEST_PATH).mtimeMs < statSync(PKG_PATH).mtimeMs` — package.json bumps per CLAUDE.md WORKFLOW = canonical staleness signal), then assertions on `dist/manifest.webmanifest` (name/short_name/start_url/display='standalone'/icons 192+512+maskable) + `dist/sw.js` (workbox runtime + `precacheAndRoute` call). Filesystem-only because playwright config uses `npm run dev` which Vite serves WITHOUT manifest (returns index.html fallback). Skips if `npm run build` fails (e.g. node-version mismatch on CI) — doesn't block other tests. NOT covered: `beforeinstallprompt` event (Chromium-only + needs HTTPS + 30-day suppression), Lighthouse PWA score. Runtime SW caching partially covered by 14.x offline tests. |
| **Realtime** (resilience — reconnect / sub re-establish) | `@realtime` | `tests/e2e/realtime/` | flat — pliki bez sub-folderów. Describes: `Realtime › Reconnect`. DONE 2026-05-25: 15.4 `reconnect-after-page-reload.spec.ts` — multi-context smoke for the WS sub re-establish contract. Both contexts navigate /chat (city) → primary sends message #1 with unique `E2E-RC-PRE-XXX` token, secondary receives via initial sub within 20 s (pre-reload health check); secondary `page.reload({ waitUntil: 'load' })` kills entire JS env + WebSocket, Chat.tsx unmount cleanup fires `supabase.removeChannel(sub)`; secondary's URL preserved, Supabase session restored from localStorage so /chat re-mounts → fresh `chatApi.subscribe('city', ...)` runs; primary sends message #2 with `E2E-RC-POST-XXX` token, secondary's FRESH sub delivers it within 30 s. Two-message structure isolates "init sub broken" vs "reconnect broken" failure modes. **Why page.reload vs real WS disconnect** (`page.route` to block ws://, network offline toggle): real disconnect simulation is brittle on WebKit + opaque to debug; reload exercises the same underlying re-subscribe path (unmount → cleanup → remount → subscribe) via the React `useEffect` lifecycle. NOT covered: real network drop, persistent message buffering during downtime, multiple reload cycles. Folder/area justification: Realtime resilience is cross-cutting (could touch party/chat/guild/friends/market), pure-multi-context, and depends on the WS layer not the feature surface — flat `realtime/` folder keeps these tests grouped without forcing a feature-specific tag. 180 s timeout for reload + 2× broadcast + safety-net character re-pick if session re-hydrate doesn't restore the active char. |

Gdy planuję pisać test w nowym area-zie której tu nie ma → dorzucam
wiersz do tej tabeli ZANIM napiszę pierwszy plik. To gwarantuje że
nazewnictwo nie się rozjedzie przy 100 testach.

### Cleanup pattern dla testów które tworzą zasoby (try/finally, NIE afterEach)

```ts
test.describe('Auth › Register', { tag: '@auth' }, () => {
    test('happy path: ...', async ({ page }) => {
        const email = generateTestEmail();
        try {
            // ... test logic + assertions
        } finally {
            await cleanupTestUserByEmail(email);
            // Finally leci nawet gdy assertion failuje → zero sierot.
            // `fullyParallel: true` może odpalić wiele tests z 1 pliku
            // równocześnie — moduł-level array tworzy race condition,
            // per-test try/finally jest atomic.
        }
    });
});
```
