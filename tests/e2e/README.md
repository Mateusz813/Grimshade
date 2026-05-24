# E2E tests — Playwright

## Filozofia

**Atomic E2E.** Każdy plik `*.spec.ts` testuje JEDNĄ rzecz. Krótki,
focused, deterministyczny.

- ❌ NIE: "user journey" testy (login → walka → loot → save → logout
  w jednym pliku). Gdy wybuchają — nie wiadomo gdzie błąd.
- ✅ TAK: każdy scenariusz osobno (`login-success.spec.ts`,
  `combat-attack-deals-damage.spec.ts`, `loot-drops-on-kill.spec.ts`).

Cel: ~100-120 atomic testów pokrywających każdą krytyczną akcję
użytkownika, łączny czas suite ~5-8 minut na CI.

## Setup state

Atomic testy NIE klikają sobie przez UI do żądanego state (np. "zaloguj
się, stwórz postać, idź do walki, atakuj") — to wolne. Zamiast tego:

1. **Direct API seed** — używamy Supabase admin SDK żeby dosypać
   testowego usera + character + state przed testem
2. **localStorage / sessionStorage injection** — `page.addInitScript`
   wkleja gotowy state przed pierwszą nawigacją

Helpery siedzą w `tests/e2e/fixtures/` (TODO: do dodania w kolejnych
commitach gdy będziemy mieli pierwszy realny test który tego potrzebuje).

## Struktura folderu

```
tests/e2e/
├── README.md                           ← ten plik
├── fixtures/                           ← shared helpers / setup
│   ├── seed.ts                         (TODO)
│   └── login.ts                        (TODO)
├── auth/                               ← single-responsibility per akcja
│   └── login-page-loads.spec.ts
├── combat/                             (TODO)
│   ├── attack-deals-damage.spec.ts
│   ├── potion-restores-hp.spec.ts
│   └── death-triggers-overlay.spec.ts
├── inventory/                          (TODO)
├── party/                              ← multi-context tests
│   └── member-sees-leader-combat.spec.ts (TODO)
└── ...
```

## Multi-context (party / Realtime testing)

Playwright pozwala odpalić 2+ niezależne browser-konteksty w jednym
teście. Tak testujemy WebSocket / Supabase Realtime flow:

```ts
test('member sees combat start when leader initiates', async ({ browser }) => {
    const ctxLeader = await browser.newContext();
    const ctxMember = await browser.newContext();
    const leaderPage = await ctxLeader.newPage();
    const memberPage = await ctxMember.newPage();
    // ... login różnych userów, party flow, asercje na obu page-ach
});
```

Realtime testy używają **pravdziwego Supabase** (local instance via
`supabase start` — Docker). Pozostałe E2E mockują Supabase calls via
`page.route()` żeby były szybsze i izolowane.

## Uruchamianie

```bash
npm run test:e2e          # headless, full suite
npm run test:e2e:ui       # Playwright UI (debug mode)
npx playwright test --headed tests/e2e/auth/  # tylko auth, z widoczną przeglądarką
npx playwright show-report  # po failu — HTML report z trace
```

## Convention: nazwy plików + testów

- Plik: `<area>/<action>-<outcome>.spec.ts`
- Test name: opisowe zdanie zaczynające się od akcji
- Polski lub angielski — konsekwentnie wewnątrz pliku

Przykład:
```ts
// tests/e2e/inventory/sell-item-adds-gold.spec.ts
test('selling item adds its gold price to player wallet', ...);
```
