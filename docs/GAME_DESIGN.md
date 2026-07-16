# Grimshade — Pełny dokument projektowy gry (GAME DESIGN)

> **Autorytatywny, wewnętrzny dokument.** Opisuje CAŁĄ mechanikę Grimshade z dokładnymi liczbami: formuły, szanse na drop, balans (na jakim sprzęcie da się pokonać bossa, ile tasków daje poziom), koszty, progi. Wszystkie liczby zostały zweryfikowane bezpośrednio w kodzie/danych (`src/systems/*`, `src/stores/*`, `src/data/*.json`). Gdzie dokumentacja/JSON są przestarzałe — **wygrywa kod**, a rozbieżność jest oznaczona.
>
> **Ten plik MUSI być aktualizowany przy KAŻDEJ zmianie backendu lub frontu** (patrz [§30 Reguła utrzymania](#30-reguła-utrzymania-obowiązkowe)). Wersja player-facing (uproszczona) żyje w [`/wiki`](../src/views/Wiki/Wiki.tsx) i `src/data/wiki.ts` — ją też się aktualizuje.
>
> Ostatnia pełna synchronizacja z kodem: 2026-07-15 (gra v1.10.x). Źródła: workflow ekstrakcji 7 domen + weryfikacja adwersarialna.

## Spis treści

1. [Przegląd i architektura](#1-przegląd-i-architektura)
2. [Klasy postaci](#2-klasy-postaci)
3. [Matematyka walki](#3-matematyka-walki)
4. [Potwory](#4-potwory)
5. [Poziomy i XP](#5-poziomy-i-xp)
6. [Taski (kontrakty)](#6-taski-kontrakty)
7. [Questy i Daily](#7-questy-i-daily)
8. [Mastery](#8-mastery)
9. [Loot i szanse na drop](#9-loot-i-szanse-na-drop)
10. [Przedmioty i ulepszanie](#10-przedmioty-i-ulepszanie)
11. [Ekonomia: sklep, potiony, eliksiry, market](#11-ekonomia-sklep-potiony-eliksiry-market)
12. [Czary i umiejętności](#12-czary-i-umiejętności)
13. [Poziom broni / Magic Level + trening](#13-poziom-broni--magic-level--trening)
14. [Bossowie](#14-bossowie)
15. [Lochy](#15-lochy)
16. [Rajdy](#16-rajdy)
17. [Transformacje](#17-transformacje)
18. [Trener](#18-trener)
19. [Arena (PvP)](#19-arena-pvp)
20. [Party](#20-party)
21. [Gildia](#21-gildia)
22. [Czat i Znajomi](#22-czat-i-znajomi)
23. [Offline hunt i tryb offline](#23-offline-hunt-i-tryb-offline)
24. [Postać: tworzenie i wybór](#24-postać-tworzenie-i-wybór)
25. [Rankingi](#25-rankingi)
26. [Miasto](#26-miasto)
27. [Śmierć i kary](#27-śmierć-i-kary)
28. [Balans — cele projektowe](#28-balans--cele-projektowe)
29. [Rozbieżności kod ↔ dokumentacja](#29-rozbieżności-kod--dokumentacja)
30. [Reguła utrzymania (obowiązkowe)](#30-reguła-utrzymania-obowiązkowe)

---

## 1. Przegląd i architektura

Grimshade to mobilna gra RPG (PWA) typu incremental/idle-combat. Gracz tworzy do **7 postaci** (1 z 7 klas), rozwija je przez polowania, lochy, bossów, rajdy, transformacje, arenę oraz grę społeczną (party, gildie, czat, rynek).

- **Front:** React 19 + Vite + TypeScript (repo `grimshade/`). Logika gry w `src/systems/`, stan w `src/stores/` (Zustand, per-postać przez `characterScope.ts`), dane w `src/data/*.json`, ekrany w `src/views/`.
- **Backend:** autorytatywny Laravel (repo `../grimshade-backend`) — anti-cheat, jedyny zapisujący. Model docelowy: **client-side prediction + server authority** (klient liczy walkę swoim silnikiem, backend waliduje przejście stanu i utrwala). Szczegóły statusu backendu w pamięci projektu.
- **Supabase:** Auth (GoTrue) + PostgreSQL + Realtime.
- **Sześć źródeł walki:** polowanie (`/combat`), lochy (`/dungeon`), bossy (`/boss`), rajdy (`/raid`), transformacje (`/transform`), arena (`/arena`) + trener (`/trainer`, piaskownica).
- **Waluty/zasoby:** złoto (gp), kamienie ulepszeń (6 tierów), skrzynie czarów (15 tierów), punkty areny (AP), punkty ligi areny (LP), miksturki/eliksiry.

---

## 2. Klasy postaci

Źródło: `src/data/classes.json`, `src/systems/levelSystem.ts`, `src/stores/characterStore.ts`, `src/views/CharacterCreate/CharacterCreate.tsx`.

### 2.1 Statystyki bazowe — DWA źródła (WAŻNE)

Istnieją dwa zestawy statystyk bazowych, które się różnią:

- **`classes.json baseStats`** — „projektowe" statystyki. Używane jako **podłoga (floor)** HP/MP w `characterStore.computeBaseStatFloor`.
- **`CharacterCreate.tsx CLASS_BASE_STATS`** — wartości faktycznie wstawiane do bazy przy tworzeniu postaci.

Po utworzeniu postaci `characterStore` wykrywa niższe HP/MP jako „uszkodzone" i **podnosi je do wartości z `classes.json`** (floor obejmuje TYLKO HP/MP). Atak i obrona **nie mają floora**, więc zostają na wartościach z `CharacterCreate`. **Efektywna postać poziomu 1 to mieszanka obu tabel:**

| Klasa | `classes.json` HP/MP/ATK/DEF | `CharacterCreate` HP/MP/ATK/DEF | **Efektywnie (lvl 1)** |
|---|---|---|---|
| Knight | 200 / 50 / 25 / 20 | 120 / 30 / 10 / 5 | **HP 200, MP 50, ATK 10, DEF 5** |
| Mage | 100 / 200 / 40 / 8 | 80 / 200 / 6 / 2 | **HP 100, MP 200, ATK 6, DEF 2** |
| Cleric | 130 / 160 / 20 / 12 | 100 / 150 / 7 / 4 | **HP 130, MP 160, ATK 7, DEF 4** |
| Archer | 120 / 80 / 35 / 10 | 100 / 80 / 10 / 3 | **HP 120, MP 80, ATK 10, DEF 3** |
| Rogue | 110 / 90 / 22 / 9 | 90 / 60 / 9 / 3 | **HP 110, MP 90, ATK 9, DEF 3** |
| Necromancer | 90 / 220 / 35 / 7 | 85 / 180 / 6 / 2 | **HP 90, MP 220, ATK 6, DEF 2** |
| Bard | 115 / 130 / 22 / 11 | 95 / 120 / 8 / 3 | **HP 115, MP 130, ATK 8, DEF 3** |

> **Wniosek:** ATK/DEF z `classes.json` (Knight 25/20) **nigdy nie są nakładane** na realną postać — to wartości referencyjne. HP/MP z `CharacterCreate` (Knight 120/30) są przejściowe (od razu podniesione). Formuły walki (`getEffectiveChar`) używają przechowywanego `char.attack` (= 10 dla świeżego Rycerza), więc każdy przykład DPS zakładający ATK 25 zawyża moc nowej postaci.

### 2.2 Modyfikatory bojowe (`classes.json` + `combatEngine.CLASS_MODIFIER`)

| Klasa | classModifier | maxCritChance | canBlock | canDodge | dualWield | armorType | mainWeapon | offHand | weapon skill(y) | specialty | color |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Knight | 1.0 | 30% | ✅ | ❌ | ❌ | heavy | sword | shield | sword_fighting + shielding | tank | `#e53935` |
| Mage | **1.3** | 30% | ❌ | ❌ | ❌ | magic | staff | spellbook | magic_level | spellcaster | `#7b1fa2` |
| Cleric | 1.0 | 30% | ❌ | ❌ | ❌ | magic | holy_wand | holy_cross | magic_level | healer | `#ffc107` |
| Archer | **1.2** | **100%** | ❌ | ✅ | ❌ | light | bow | quiver | distance_fighting | ranged | `#4caf50` |
| Rogue | 1.0 | **100%** | ❌ | ✅ | ✅ (60%) | light | dagger | dagger | dagger_fighting | crit | `#212121` |
| Necromancer | **1.2** | 30% | ❌ | ❌ | ❌ | magic | dead_staff | voodoo_doll | magic_level | summon | `#795548` |
| Bard | 1.0 | 30% | ❌ | ✅ | ❌ | light | harp | talisman | bard_level | support | `#ff9800` |

`classModifier` mnoży obrażenia gracza. `maxCritChance` to twardy cap % krytyka klasy (Archer/Rogue 100%, reszta 30%) — osobny od globalnego capu agregacji krytyka 50% (patrz §3).

### 2.3 Przyrost na poziom (REALNY — `levelSystem.ts:160-168`)

`classes.json hpPerLevel/mpPerLevel` są **przestarzałe (tylko wyświetlanie na ekranie tworzenia)**. Realny przyrost:

| Klasa | HP/poziom (`BASE_HP_PER_LEVEL`) | MP/poziom (`BASE_MP_PER_LEVEL`) |
|---|---|---|
| Knight | 8 | 2 |
| Mage | 3 | 8 |
| Cleric | 5 | 6 |
| Archer | 4 | 3 |
| Rogue | 4 | 3 |
| Necromancer | 3 | 9 |
| Bard | 4 | 5 |

- **Atak/obrona NIE rosną automatycznie co poziom.** Rosną tylko z: (a) punktów statystyk — **2 na poziom, dla każdej klasy** (`STAT_POINTS_PER_CLASS ?? 2`), oraz (b) milestone'ów co 10 poziomów.
- **Anti-exploit:** punkty statystyk i przyrost HP/MP przyznawane są tylko za poziomy **powyżej `highest_level`** — po śmierci i ponownym wbiciu nie dostajesz ich drugi raz.

### 2.4 Milestone co 10 poziomów (`characterStore.ts:84-99`, `MILESTONE_INTERVAL = 10`)

| Klasa | +HP | +MP | +ATK | +DEF |
|---|---|---|---|---|
| Knight | 30 | 5 | 1 | 1 |
| Mage | 10 | 25 | 1 | 1 |
| Cleric | 15 | 20 | 1 | 1 |
| Archer | 15 | 10 | 1 | 1 |
| Rogue | 15 | 8 | 1 | 1 |
| Necromancer | 12 | 22 | 1 | 1 |
| Bard | 15 | 15 | 1 | 1 |

Bazowe max HP na poziomie `L` (bez gearu): `classBaseHp + BASE_HP_PER_LEVEL·(L−1) + floor(L/10)·milestoneHp`. Przykład — Rycerz L100: `200 + 8·99 + 10·30 = 1292 HP`. Milestone złota: `level·10000` na poziomach 10/20/30/40/50 i co 50 od 100.

### 2.5 Regeneracja per klasa (`skillSystem.ts:211-229`)

Mnożniki HP/MP regen z treningu (bonus = poziom skilla treningowego × rate):

| Klasa | HP regen rate | MP regen rate |
|---|---|---|
| Knight | 0.20 | 0.05 |
| Mage | 0.05 | 0.20 |
| Cleric | 0.15 | 0.18 |
| Archer | 0.10 | 0.08 |
| Rogue | 0.08 | 0.06 |
| Necromancer | 0.06 | 0.18 |
| Bard | 0.12 | 0.15 |

Twarde capy: HP regen **5% max HP/s**, MP regen **5% max MP/s**. **UWAGA:** nie ma pasywnej regeneracji MP 0.5%/s — jeśli `mp_regen` = 0 (brak treningu/transformacji), MP nie regeneruje się w ogóle (CLAUDE.md o „0.5% pasywne" jest przestarzałe).

---

## 3. Matematyka walki

Źródło: `src/systems/combat.ts` (czysta matematyka), `combatEngine.ts` (orkiestrator).

### 3.1 Jedna formuła obrażeń — `calculateDamage` (`combat.ts:43`)

Wszystkie obrażenia (gracz→potwór, potwór→gracz, boty, arena) przechodzą przez jedną funkcję:

```
baseDamage  = (baseAtk + weaponAtk + skillBonus) × classModifier
finalDamage = max(1, baseDamage − enemyDefense)        // podłoga mitygacji = 1
if isDodged:  finalDamage = 0
if isCrit:    finalDamage ×= critDmgMult (domyślnie 2.0)
if isBlocked: finalDamage  = floor(finalDamage × 0.5)  // blok = −50%
if dmgMult≠1: finalDamage ×= damageMultiplier
return max(1, floor(finalDamage))
```

Domyślne wartości parametrów: `critChance 0.05`, `critDmg 2.0`, `blockChance 0`, `dodgeChance 0`, `maxCritChance 1.0`, `classModifier 1`, `damageMultiplier 1`. Kolejność: dodge → crit → block → mnożnik. Mitygacja floor = 1 (każdy cios trafia min. za 1).

**Gracz → potwór (`combatEngine.ts:1083-1165`):** `baseAtk = char.attack` (efektywny), `weaponAtk = floor(rollWeaponDamage() × dmgPercent)`, `skillBonus = getClassSkillBonus(...)`, `classModifier`, `enemyDefense = monster.defense`, `critChance = char.crit_chance + bonusy`, `maxCritChance = classConfig.maxCritChance/100`, `damageMultiplier = atkDmg × transform × mods`.

**Potwór → gracz (`combatEngine.ts:1622-1629`):** `baseAtk = rollMonsterDamage(monster)`, `weaponAtk=0`, `skillBonus=0`, `classModifier=1.0`, `enemyDefense = floor(char.defense × defBuffMult)`, plus block/dodge gracza. Potwory nie mają weapon roll/skill/class-mod, ale mają **latentne 5% krytyka** (domyślny `critChance 0.05` w `calculateDamage`).

### 3.2 Krytyk, blok, unik

- **Krytyk — dwa capy:** (1) cap agregacji `min(0.5, ...)` w `getEffectiveChar` → widoczny efektywny krytyk max 50%; (2) cap klasowy przy trafieniu `min(critChance, maxCritChance)` (Archer/Rogue 100%, reszta 30%). Netto: Archer/Rogue mogą wykorzystać pełne 50%, reszta jest ograniczona do 30%. Domyślny krytyk = 5%. Auto-cast skilla ma zaszyty krytyk 20%. Mnożnik krytyka domyślnie ×2.0 (bez capu, additive z gearu/treningu).
- **Blok (tylko Knight, fizyczne):** `min(0.25, 0.05 + shieldingLevel × 0.005)` — baza 5%, +0.5%/lvl Shielding, max **25%**. Blok = obrażenia ×0.5.
- **Unik (Archer/Rogue/Bard, fizyczne):** baza 5% + per poziom agility → Archer +0.4%/lvl (max 20%), Rogue +0.5%/lvl (max 20%), Bard +0.3%/lvl (max 15%). Unik = obrażenia 0.

### 3.3 Dual wield (Rogue) — `combat.ts:90-104`

Każda ręka trafia niezależnie za **60% weapon damage** (2 niezależne rolle krytyka): `hit1 = floor(weaponAtk × 0.6)`, `hit2 = floor(offHandAtk × 0.6)`, suma. Tylko Rogue (`dualWield:true, dualWieldDmgPercent:60`).

### 3.4 Prędkość ataku → kadencja (`getAttackMs`, `combatEngine.ts:546`)

```
getAttackMs(speed) = max(500, floor(3000 / max(1, speed)))
playerIntervalMs   = max(200, getAttackMs(speed) / SPEED_MULT[combatSpeed])
```

`SPEED_MULT = { x1:1, x2:2, x4:4 }`, SKIP = natychmiast. Przy x1 podłoga = 500 ms (osiągana przy speed ≥ 6.0); przy x2/x4 twarda podłoga = 200 ms. (CLAUDE.md „max ~4.0" to przestarzała stała `calculateAttackInterval` na bazie 2000.)

| attack_speed | getAttackMs (x1) | x2 | x4 |
|---|---|---|---|
| 1.0 | 3000 | 1500 | 750 |
| 2.0 | 1500 | 750 | 375→200 |
| 2.5 | 1200 | 600 | 300 |
| 4.0 | 750 | 375 | 200 |
| 6.0+ | 500 | 250 | 200 |

### 3.5 `getEffectiveChar` — agregacja statystyk (`combatEngine.ts:571-604`)

Łączy base + ekwipunek (`eq`) + trening skilli (`tb`) + eliksiry + transformacje + **karę za lukę w gearze**:

```
rawAttack  = (char.attack + eq.attack + elixirAtk + transformFlatAtk) × gearGapMult
attack     = floor(rawAttack × transformAtkPctMult)
max_hp     = floor((char.max_hp + eq.hp + tb.max_hp + elixirHp + transformFlatHp) × elixirHpPct × transformHpPct)
crit_chance= min(0.5, baseCrit + eq.critChance×0.01 + tb.crit_chance)   // HARD CAP 50%
attack_speed = (char.attack_speed + eq.speed×0.01 + tb.attack_speed) × elixirAsMult
```

Gear-gap mnoży **tylko atak** i tylko dla gracza/lidera (nie botów). Eliksiry: +500 HP/MP, +50 ATK/DEF, ×1.25 HP%/MP%, ×1.20 AS.

### 3.6 Kara za lukę w gearze — `getGearGapMultiplier` (`itemSystem.ts:545`)

```
if contentLevel <= 0 || gearLevel >= contentLevel: return 1
return max(0.05, (gearLevel / contentLevel)²)
```

`gearLevel` = średni itemLevel założonego EQ. Aplikowana do ataku gracza w hunt/boss/dungeon/transform/raid.

| gear ÷ content | mnożnik | efekt |
|---|---|---|
| ≥ 1.00 | 1.00 | pełna moc |
| 0.90 | 0.81 | lekka kara |
| 0.75 | 0.56 | ~½ obrażeń |
| 0.50 | 0.25 | 4× wolniej |
| ≤ 0.224 | 0.05 (podłoga) | praktycznie niemożliwe |

Koniec „gear L100 zabija bossa L200".

### 3.7 Mnożniki obrażeń/leczenia (eliksiry, transformacje, upgrade skilli)

Eliksiry (`combatElixirs.ts`): `atk_dmg_100/50/25` = ×2.0/1.5/1.25; `spell_dmg_*` analogicznie; `hp_pct_25`/`mp_pct_25` = ×1.25 max; `atk_boost_50`/`def_boost_50` = +50 flat; `attack_speed` = ×1.20. Tiery nie mutex — kilka może być aktywnych, ale drenuje i liczy się najwyższy.

Upgrade skilla w walce `getCombatSkillUpgradeMultiplier(U)` = `1 + min(U,10)×0.02 + max(0,U−10)×0.01` → +5 = ×1.10, +10 = ×1.20, +20 = ×1.30, +30 = ×1.40.

**Capy anty-one-shot:** instant-kill na splash AOE = `max(splashDmg, 12% max HP)`; Necro `death_apocalypse` = 12% max HP; `execute_below` dobija tylko cele <20% HP; `def_pen` cap 60%.

### 3.8 HP/MP regen (`useMpRegen.ts`, tick 1000 ms)

```
hpRegenCapped = min(effectiveMaxHp × 0.05, hp_regen_flat)   // cap 5% max HP/s
mpRegenCapped = min(effectiveMaxMp × 0.05, mp_regen_flat)   // cap 5% max MP/s
```

Base `hp_regen`/`mp_regen` = 0 przy tworzeniu; rosną z treningu/transformacji/gearu. Brak pasywnej podłogi 0.5%.

---

## 4. Potwory

Źródło: `src/data/monsters.json` (60 potworów), `lootSystem.ts`, `combatEngine.ts`.

### 4.1 Rzadkość potwora (`rollMonsterRarity`)

Bazowe szanse `MONSTER_RARITY_CHANCES` (`lootSystem.ts:23`): normal **90%**, strong **7%**, epic **1.5%**, legendary **1%**, boss **0.5%**. `normal` = reszta po odjęciu (min 1%). SKIP zawsze → normal.

Mnożniki statystyk `MONSTER_RARITY_MULTIPLIERS` (`lootSystem.ts:31`, hunt):

| Rzadkość | HP× | ATK× | DEF× | XP× | Gold× | task-kills | max item rarity | kamień |
|---|---|---|---|---|---|---|---|---|
| normal | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1 | common | common_stone |
| strong | 1.5 | 1.2 | 1.3 | 2.0 | 2.0 | 3 | rare | rare_stone |
| epic | 2.5 | 1.6 | 1.5 | 4.0 | 4.0 | 10 | epic | epic_stone |
| legendary | 5.0 | 1.8 | 1.8 | 10.0 | 10.0 | 50 | legendary | legendary_stone |
| boss | 10.0 | 2.5 | 2.0 | 30.0 | 30.0 | 200 | mythic | mythic_stone |

> **UWAGA — trzy różne tabele XP/gold rzadkości** (patrz §29): hunt (powyżej, boss ×30/30), raid `combat.ts MONSTER_STAT_MULTIPLIERS` (boss ×10 XP / ×15 gold), offline-hunt `RARITY_*_MULT` (boss ×8/8). Task/mastery kill-weights są jednak wspólne: 1/3/10/50/200.

Bonusy mastery do rzadkości (per poziom mastery danego potwora): strong +1%/lvl, epic +0.5%, legendary +0.25%, boss +0.1% (max mastery 25 → strong 32%, epic 14%, legendary 7.25%, boss 3%).

### 4.2 Obrażenia potwora — `rollMonsterDamage` (`combat.ts:247`)

`min = floor(attack×0.8)`, `max = floor(attack×1.2)`, roll uniform w [min, max] (±20%). Wszystkie 60 potworów mają `speed: 2` → cios co 1500 ms (przed dzieleniem prędkością walki).

### 4.3 Pełna progresja 60 potworów (base, przed mnożnikami rzadkości)

Reprezentatywny wycinek (pełna tabela w `monsters.json`). `gold` = zakres [min,max]:

| id | Lvl | HP | ATK | DEF | XP | Gold |
|---|---|---|---|---|---|---|
| rat | 1 | 60 | 8 | 1 | 3 | 1–1 |
| orc | 5 | 69 | 9 | 1 | 18 | 2–5 |
| dark_elf | 10 | 83 | 13 | 1 | 41 | 5–10 |
| bandit | 11 | 243 | 52 | 4 | 46 | 5–11 |
| cyclops | 15 | 306 | 65 | 5 | 67 | 7–15 |
| dark_mage | 20 | 389 | 83 | 6 | 76 | 10–20 |
| demon_imp | 30 | 541 | 115 | 8 | 119 | 15–30 |
| greater_demon | 50 | 846 | 178 | 13 | 209 | 25–50 |
| infernal_warlord | 100 | 1606 | 337 | 24 | 451 | 50–100 |
| chaos_titan | 200 | 2933 | 654 | 46 | 977 | 100–200 |
| death_knight | 300 | 4260 | 971 | 69 | 1538 | 150–300 |
| celestial_destroyer | 500 | 6914 | 1606 | 114 | 2732 | 250–500 |
| storm_titan | 600 | 8242 | 1923 | 136 | 3356 | 300–600 |
| ancient_god_spawn | 800 | 10897 | 2558 | 181 | 4645 | 400–800 |
| world_ender | 1000 | 13550 | 3192 | 226 | 5981 | 500–1000 |

**Strefa startowa L1–10** (rat→dark_elf, HP 60→83, ATK 8→13) jest kalibrowana **bez gearu** — ubijalna gołymi rękami. Skok następuje na L11 (`bandit` HP 243, ATK 52), gdzie kalibrator zakłada, że gracz ma już sprzęt. Powyżej L11: HP ~13/lvl, ATK ~3.2/lvl, DEF ~0.23/lvl, XP ~5.9/lvl, gold max = poziom potwora.

---

## 5. Poziomy i XP

Źródło: `src/systems/levelSystem.ts`.

### 5.1 Krzywa XP — trzy reżimy

```
L < 100:      xpToNextLevel(L) = max(300, floor(300 × L^1.5))
100 ≤ L ≤ 1000: interpolacja liniowa między kotwicami
L > 1000:     floor(kotwica_1000 × 1.10^(L−1000))     // +10%/poziom
```

Kotwice (`levelSystem.ts:4`): 100 → 300 000, 200 → 7 327 500, 400 → 31 875 000, 600 → 100 680 000, 800 → 696 750 000, 1000 → 897 150 000. `HARD_SAFETY_CAP = 10 000`.

| Poziom | XP na kolejny | Skumulowane XP do osiągnięcia |
|---|---|---|
| 1 | 300 | 0 |
| 2 | 848 | 300 |
| 5 | 3 354 | 5 106 |
| 10 | 9 486 | 33 313 |
| 25 | 37 500 | 356 419 |
| 50 | 106 066 | 2 068 522 |
| 100 | 300 000 | 11 850 321 |
| 200 | 7 327 500 | 389 711 571 |
| 300 | 19 601 250 | 1 730 012 171 |
| 500 | 66 277 500 | 9 188 111 521 |
| 1000 | 897 150 000 | 256 253 550 269 |

### 5.2 Co daje level-up

- **2 punkty statystyk** (każda klasa; rozdawane: +5 HP / +5 MP / +1 ATK / +1 DEF za punkt).
- Przyrost HP/MP wg §2.3, milestone co 10 poziomów wg §2.4.
- Tylko za poziomy powyżej `highest_level` (anti-exploit po śmierci).
- XP z zabicia potwora = statyczny `monster.xp` × mnożnik rzadkości × mnożnik mastery × modyfikatory transformacji (brak formuły — wartości precomputowane w `monsters.json`).

---

## 6. Taski (kontrakty)

Źródło: `src/data/tasks.json` (600 wpisów), `taskRewards.ts`, `taskStore.ts`, `progression.ts`.

### 6.1 Struktura

Każdy z **60 potworów** ma **10 progów zabójstw**: **10, 50, 100, 200, 500, 1000, 2500, 5000, 10000, 100000** (id `<monsterId>_<count>`). 60 × 10 = 600 wpisów.

> Kolumny `rewardGold/rewardXp` w `tasks.json` to **przestarzały snapshot** — gra przelicza nagrody na żywo z `monsters.json`.

### 6.2 Formuła nagrody (`taskRewards.ts:46`)

```
rewardXp   = floor(effectiveXpPerKill(monster) × killCount × 1.5)
rewardGold = floor(monster.gold[1] × killCount × 3)
```

`effectiveXpPerKill`: dla `monster.level < 300` = `monster.xp`; dla `≥ 300` = override geometryczny (kotwica = XP najniższego potwora L≥300, ratio 1.05 na kolejny) — celowo obniża XP wysokich tasków (np. L1000 z 5981 do ~3045/kill).

### 6.3 Kill-weights wg rzadkości

`MONSTER_RARITY_TASK_KILLS = {normal:1, strong:3, epic:10, legendary:50, boss:200}`. Zabójstwo boss-wariantu = 200 „normalnych" w pasku taska (i mastery).

### 6.4 BALANS — ile tasków na poziom

`tasks/level = xpToNext(L) / taskXP`. Dla taska ×1000 zabójstw potwora na poziomie gracza:

| Poziom gracza | Task ×1000 | Task XP (live) | xpToNext | Tasków/poziom |
|---|---|---|---|---|
| 20 | dark_elf | 61 500 | 26 832 | ≈0.44 (1 task = ~2.3 poziomy) |
| 50 | greater_demon | 313 500 | 106 066 | ≈0.34 (~2.95 poziomu/task) |
| 100 | infernal_warlord | 676 500 | 300 000 | ≈0.44 (~2.25 poziomu/task) |
| 200 | chaos_titan | 1 465 500 | 7 327 500 | ≈5.0 (5 tasków ×1000 na 1 poziom) |

**Wniosek:** L20–L100 — jeden task ×1000 = 2–3 poziomy postaci (szybki rozwój). Około L200 krzywa XP przegania nagrody tasków — leveling gated przez krzywę, nie przez taski. (×1000 to *ważone* zabójstwa: przeciw bossom to tylko 5 realnych zabójstw, przeciw normalnym 1000.)

### 6.5 Limity i dostępność

- **Limit aktywnych tasków: 2** (UI `Tasks.tsx MAX_ACTIVE_TASKS = 2`, licznik „X/2"). Store technicznie egzekwuje tylko „jeden task per potwór" — patrz §29.
- Kill rejestrowany z: live combat, offline hunt, dungeon, boss, raid, transform.
- Claim ręczny („Odbierz nagrodę") → przelicza świeże liczby, `addGold + addXp`, push do `completedTasks` (ostatnie 20).
- Dostępność (`progression.ts`): (1) level-gate `monster.level > charLevel` → zablokowane; (2) mastery-gate — potwory sortowane rosnąco, każdy wymaga mastery ≥ 1 na poprzednim.

---

## 7. Questy i Daily

### 7.1 Questy (`quests.json`, 345 questów)

Jednorazowe, `minLevel` 5→1000, brak limitu aktywnych. Typy celów: `kill` (286), `kill_rarity` (59), `complete_dungeons_any` (34), `drop_rarity` (34), `kill_bosses_any` (32), `dungeon` (29), `mastery_total` (21), `boss` (18), `mastery_max_count` (15), `mastery_all_at_level` (4). Nagrody: gold (każdy quest), elixir (308), stone (239), stat_points (43), item (29), xp (21). Magnitudy: gold 100→100 000 000, XP 10 000→25 000 000. Quest bez explicit `item` dorzuca losowy przedmiot dla klasy (rare 55% / epic 30% / legendary 12% / mythic 3%, itemLevel = quest.minLevel).

### 7.2 Daily (`dailyQuests.json`, 27 definicji)

**12 zadań/dzień** (`DAILY_QUEST_COUNT = 12`), unlock **poziom 25**, reset o północy lokalnie, deterministyczny wybór (seed z daty → wszyscy widzą tę samą pulę). Typy: `deal_damage` (7), `kill_any` (7), `earn_gold` (5), `complete_dungeon` (3), `use_potion` (3), `kill_boss` (2). Skalowanie nagród: `gold = floor(base.gold × (1 + lvl×0.25) × 0.6)`, `xp = floor(base.xp × (1 + lvl×0.3))`. Przykład L50, base {200,100}: gold 1620, xp 1600.

---

## 8. Mastery

Źródło: `masteryStore.ts`.

- **Zakres 0–25 per potwór.** Kille na poziom: `5000 × (currentLevel + 1)` → 0→1 = 5000, 1→2 = 10000, ..., 24→25 = 125000. **Total do max = 5000 × 325 = 1 625 000 ważonych killi** (= 8125 zabójstw boss-wariantu przy weight 200).
- **Bonusy per poziom:** +2% XP i +2% gold z tego potwora (max +50% na 25). Bonus spawn-rate rzadszych wariantów: strong +1%/lvl, epic +0.5%, legendary +0.25%, mythic +0.1%.
- **Heroic drop unlock na 25:** `HEROIC_DROP_RATE_AT_MAX = 0.005` (0.5% z boss-wariantu, dalej skalowane poziomem potwora — patrz §9.7). Poniżej 25 heroic = 0.
- Mastery ≥ 1 odblokowuje kolejnego potwora na liście.
- **„Punkty masterii" (`mastery_points`)** = suma poziomów mastery wszystkich potworów (ranking). Rosną automatycznie, nie wydaje się ich.

---

## 9. Loot i szanse na drop

Źródło: `lootSystem.ts`, `itemGenerator.ts`, `combatEngine.ts`. **Wszystkie `dropTable` potworów są puste — loot jest w 100% proceduralny** (napędzany poziomem + rzadkością potwora).

### 9.1 Pełen ciąg rolli na 1 zabójstwo

1. Rzadkość potwora (rolowana na starcie walki).
2. **Złoto** — `calculateGoldDrop` × mnożnik mastery gold.
3. **Itemy** — `ROLL_COUNTS[rarity]` niezależnych rolli, każdy sukces przy `BASE_DROP_CHANCES[rarity]`; cap 5 itemów.
4. **Kamień** — 1 roll.
5. **Miksturki** — 2 niezależne rolle (+2 mega przy L≥100).
6. **Skrzynie czarów** — roll KAŻDEGO tieru ≤ poziom potwora niezależnie.

### 9.2 Rolle itemów (`ROLL_COUNTS` / `BASE_DROP_CHANCES`)

| Rzadkość potwora | Rolle/kill | Szansa/roll | Szansa ≥1 itemu |
|---|---|---|---|
| normal | 2 | 8% | 15.4% |
| strong | 3 | 12% | 31.9% |
| epic | 4 | 15% | 47.8% |
| legendary | 5 | 20% | 67.2% |
| boss | 6 | 30% | 88.2% |

### 9.3 Rzadkość itemu (`rollRarity`, progi `[0.55,0.25,0.12,0.05,0.025,0.005]`)

Efektywny rozkład rzadkości itemu na roll, per rzadkość potwora (cap = max rarity potwora):

| Rzadkość potwora (cap) | common | rare | epic | legendary | mythic | heroic |
|---|---|---|---|---|---|---|
| normal (→common) | 100% | – | – | – | – | – |
| strong (→rare) | 55% | 45% | – | – | – | – |
| epic (→epic) | 55% | 25% | 20% | – | – | – |
| legendary (→legendary) | 55% | 25% | 12% | 8% | – | – |
| boss (→mythic) | 55% | 25% | 12% | 5% | 3% | (heroic tylko short-circuit) |

**Heroic** dropuje TYLKO z boss-wariantu i tylko gdy `heroicDropRate > 0` (mastery 25) — sprawdzane przed rozkładem.

### 9.4 Generowanie itemu (`itemGenerator.ts`)

Kategoria (`ITEM_CATEGORY_WEIGHTS`): weapon 20%, offhand 15%, armor 45% (uniform 1/6 slot), accessory 20% (uniform 1/3). Statystyka bazowa: `floor((randInt(baseMin,baseMax) + floor(level×perLevel)) × statMultiplier)`. `ARMOR_HP_MULTIPLIER = 6` dla slotów HP.

Mnożniki statystyk rzadkości (`itemTemplates.json`): common 1.0, rare 1.15, epic 1.30, legendary 1.45, mythic 1.60, **heroic 2.05**.

Sloty bonusów (`RARITY_BONUS_SLOTS`): common 0, rare 1, epic 1, legendary 2, mythic 3, **heroic 5**. Magnitudy bonusów (`BONUS_STAT_RANGES` generatora): common 1–5, rare 3–12, epic 5–18, legendary 10–35, mythic 20–60, heroic 40–100. Mnożniki per stat: critChance ×0.3, critDmg ×1.5, reszta ×1.0. Pula: hp/mp/attack/defense/speed/critChance/critDmg.

### 9.5 Złoto (`calculateGoldDrop`)

`base = randInt(min,max)`, `× (1 + (partySize−1)×0.15)` — ale w live combat `partySize` domyślnie 1 (bonus party nie działa na złoto). Po rollu `× (1 + masteryLevel×0.02)`.

### 9.6 Kamienie i miksturki

**Kamień (`rollStoneDrop`, 1 roll):** normal 10%, strong 7%, epic 4%, legendary 2%, boss 1% (tier = tier potwora). `heroic_stone` NIE dropuje z zabójstw (tylko konwersja/rozłożenie/refund/market).

**Miksturki (`rollPotionDrop`):** 2 rolle (HP + MP) o szansie zależnej od poziomu — L≥600 divine 0.1%, ≥400 ultimate 0.1%, ≥200 super 0.1%, ≥100 great 0.1%, ≥50 lg 0.4%, ≥20 md 0.4%, <20 sm 0.4%. Plus przy L≥100 dwa rolle mega (HP/MP +1000) po 0.4% każdy.

### 9.7 Skrzynie czarów (`rollSpellChestDrop`, gate L≥5)

15 tierów `SPELL_CHEST_LEVELS`. Baza per rzadkość: normal 0.1%, strong 0.5%, epic 1%, legendary 1.5%, boss 2%. Mnożniki: dungeon ×1.5, boss-view ×2.0. **Roll KAŻDEGO tieru ≤ poziom potwora niezależnie** → wysokopoziomowy potwór może dropnąć wiele skrzyń. Heroic bonus (max mastery + boss): +5% per tier.

### 9.8 Heroic — podwójny gate

Wymaga: (1) monster roluje boss-rarity NA tym zabójstwie, ORAZ (2) mastery 25 na tym potworze. Skalowanie stawki poziomem (`scaleHeroicDropRate`): ≤100 = 0.5%, 200 = 0.456%, 500 = 0.322%, 1000 = 0.1% (podłoga). Heroic = celowy ultra-endgame chase.

### 9.9 Auto-sell wygenerowanego lootu (`getGeneratedSellPrice`)

`floor(SELL_MULT × level + BASE_PRICE)`: common 5/+10, rare 20/+50, epic 60/+200, legendary 150/+500, mythic 400/+2000, heroic 800/+5000. Przykład @L100: common 510, heroic 85 000.

### 9.10 Auto-sprzedaż i auto-rozkład lootu (ustawienia gracza)

Konfigurowane w Ekwipunku (`settingsStore`, per-postać). Obie opcje działają **tylko na loot z walki** (`combatEngine.dropLootToInventory`) — nie ruszają przedmiotów kupionych/z marketu/z depozytu. Decyzja per-drop (kolejność):

1. **Auto-sprzedaż** (`autoSellCommon..autoSellMythic`): jeśli flaga dla rzadkości włączona **i** poziom itemu ≤ `autoSellMaxLevel` (0 = bez limitu) → item sprzedany od razu za `getGeneratedSellPrice`, złoto dodane, item nie trafia do torby. Heroic nigdy nie jest auto-sprzedawany (brak flagi).
2. **Auto-rozkład** (`autoDisassembleCommon..autoDisassembleMythic`): sprawdzany tylko gdy auto-sprzedaż NIE zadziałała. Jeśli flaga dla rzadkości włączona **i** poziom itemu ≤ `autoDisassembleMaxLevel` (0 = bez limitu) → item rozłożony (20% szansy na 1 kamień tier rzadkości, jak ręczne rozłożenie), item nie trafia do torby.
3. W przeciwnym razie item trafia do torby (`addItem`).

**Auto-sprzedaż ma priorytet nad auto-rozkładem** dla tej samej rzadkości. `autoSellMaxLevel` jest też egzekwowany w sieci bezpieczeństwa `inventoryStore.addItem`, żeby filtr poziomu nie był omijany. Podsumowanie łupu (CombatBackpackModal) grupuje osobno itemy sprzedane / rozłożone (tooltip „rozłożono (+N kamieni)").

---

## 10. Przedmioty i ulepszanie

Źródło: `itemSystem.ts`, `itemTemplates.json`, `items.json`.

### 10.1 12 slotów

`mainHand, offHand, helmet, shoulders, armor, gloves, pants, boots, ring1, ring2, necklace, earrings`. Sloty skalujące bazę z upgrade'em: broń/off-hand (dmg/attack/defense), hełm/naramienniki/zbroja/spodnie/buty (hp), rękawice/pierścienie (attack), naszyjnik/kolczyki (defense). Klasa nosi tylko swój typ broni/off-handu i armor prefix; pierścienie/naszyjnik/kolczyki bez ograniczeń.

### 10.2 6 rzadkości

| Rzadkość | statMult | bonus sloty | sell mult (legacy) | kolor |
|---|---|---|---|---|
| common | 1.00 | 0 | 0.20 | `#9e9e9e` |
| rare | 1.15 | 1 | 0.35 | `#2196f3` |
| epic | 1.30 | 1 | 0.50 | `#4caf50` |
| legendary | 1.45 | 2 | 0.65 | `#f44336` |
| mythic | 1.60 | 3 | 0.80 | `#ffc107` |
| heroic | 2.05 | 5 | 1.00 | `#9c27b0` |

### 10.3 Ulepszanie +1..+30 (`getEnhancementMultiplier`)

`mult(U) = 1 + 0.10·U` (LINIOWE, +10%/lvl). +5 = 1.50, +10 = 2.00, +30 = 4.00. Statystyka: `max(round(base×mult), base+U)` (podłoga +1/lvl). Kamień = tier rzadkości itemu.

| Poziom | Kamienie | Złoto | Szansa | Skumulowane kamienie | Skumulowane złoto |
|---|---|---|---|---|---|
| +1 | 1 | 100 | 100% | 1 | 100 |
| +2 | 1 | 500 | 80% | 2 | 600 |
| +3 | 2 | 2 000 | 60% | 4 | 2 600 |
| +4 | 3 | 5 000 | 45% | 7 | 7 600 |
| +5 | 5 | 15 000 | 30% | 12 | 22 600 |
| +6 | 8 | 50 000 | 20% | 20 | 72 600 |
| +7 | 12 | 150 000 | 15% | 32 | 222 600 |
| +8 | 20 | 500 000 | 10% | 52 | 722 600 |
| +9 | 35 | 1 500 000 | 5% | 87 | 2 222 600 |
| +10 | 50 | 5 000 000 | 2% | 137 | 7 222 600 |
| +15 | 180 | 35 000 000 | 0.3% | 717 | 105 222 600 |
| +20 | 580 | 200 000 000 | 0.01% | 2 647 | 675 222 600 |

Powyżej +20: `stones = ceil(580×1.3^(N−20))`, `gold = ceil(200M×1.5^(N−20))`, `rate = max(0.001%, 0.01%×0.5^(N−20))`. **Porażka zabiera złoto+kamienie, NIE niszczy itemu ani nie obniża poziomu.**

### 10.4 Kamienie

6 tierów (common→heroic). Konwersja: **100 niższych + 1000 złota → 1 wyższego** (`STONE_CONVERSION_CHAIN`). `heroic_stone` = szczyt (bez konwersji w górę).

### 10.5 Zwrot, sprzedaż, rozłożenie, reroll

- **Refund (`getEnhancementRefund`):** 100% złota i kamieni z ulepszeń (kolumny skumulowane z §10.3). Udane ulepszanie nigdy nie jest stratą.
- **Sell (`getSellPrice`):** `basePrice × RARITY_SELL_MULTIPLIER + refund_gold` (legacy) lub `SELL_PRICES[rarity](level) + refund` (generated). Przykład: iron_sword common +2 = 16 + 600 = **616 g** + 2× common_stone.
- **Rozłożenie (disassemble):** 20% szansy na 1 kamień tier itemu (pojedynczo/masowo/auto z lootu — patrz §9.10), item zawsze zużyty. Masowe rozłożenie zwraca `{ stonesGained, disassembled }` → UI pokazuje ile rozłożono i ile kamieni wpadło.
- **Reroll bonusów:** 2 kamienie tier itemu (tylko rarity > common), zachowuje bazę, losuje nowe bonusy.
- **Śmierć:** traci `max(1, floor((bag+equipped)×0.05))` itemów (5%, min 1), tylko powyżej lvl 50; depozyt bezpieczny; `amulet_of_loss` chroni.
- Bag = 1000, depozyt = 10000.

---

## 11. Ekonomia: sklep, potiony, eliksiry, market

Źródło: `shopStore.ts`, `potionSystem.ts`, `potionConversion.ts`, `marketSystem.ts`, `goldFormat.ts`.

### 11.1 Formatowanie złota

`GOLD_PER_K = 1 000`, `GOLD_PER_CC = 100 000`, `GOLD_PER_SC = 10 000 000` (1 sc = 10 mln gp). `formatGoldShort` pokazuje najwyższy tier, obcięty (nie zaokrąglany w górę), np. 5 138 755 → „51,38 cc".

### 11.2 Sklep — sprzęt

Generuje sprzęt klasy dla common+rare do poziomu `min(charLevel, 100)`. Cena: `floor((CATEGORY_BASE_MULT × level + 20) × RARITY_PRICE_MULT)`. CATEGORY: weapon 30, offhand 25, armor 20, accessory 16. RARITY_PRICE_MULT: common 1, rare 12. Przykłady: broń common L1 = 50 g, broń rare L1 = 600 g, broń rare L100 = 36 240 g.

### 11.3 Miksturki HP/MP (identyczne ceny HP=MP)

| ID | Efekt | Cena | minLvl |
|---|---|---|---|
| sm | +50 HP / +30 MP | 30 | 1 |
| md | +150 / +100 | 150 | 20 |
| lg | +400 / +300 | 600 | 50 |
| mega | +1000 / +1000 | 15 000 | 100 |
| great | 20% max | 200 000 | 200 |
| super | 35% max | 350 000 | 350 |
| ultimate | 50% max | 500 000 | 500 |
| divine | 100% max | 1 000 000 | 700 |

Cooldown: flat 1000 ms, pct 500 ms. Auto-miksturki: 4 sloty (Flat-HP, Flat-MP, Pct-HP, Pct-MP), domyślne progi 50%/50% (flat) i 40%/40% (pct). Konwersja („Alchemia", 0 złota): sm×5→md, md×4→lg, lg×334→great, great×2→super, super×2→ultimate, ultimate×2→divine, oraz lg×25→mega (MP analogicznie).

### 11.4 Eliksiry (`ELIXIRS`)

- **XP:** xp_boost +50%/1h (100k), xp_boost_100 +100%/1h (200k), premium_xp_boost ×2/12h (10M). Skill: skill_xp_boost +50%/1h (20k), +100% (50k). **XP/skill boosty działają na WSZYSTKIE źródła XP** (polowanie, taski, questy, lochy, bossy, rajdy, transformy, offline) i **timer leci realnie od użycia** (nie pauzuje poza walką) — patrz §11.4a.
- **Bojowe (15 min, pausable, tylko w walce):** attack_speed +20% (120k), cd_reduction −20% cooldownów/30min (150k), atk_dmg I/II/III +25/50/100% (50k/150k/500k), spell_dmg I/II/III analogicznie.
- **Statowe:** hp_boost +500 maxHP (5k), mp_boost +500 (5k), atk_boost +50 ATK+50 DEF (80k), hp_pct_25 +25% maxHP (350k), mp_pct_25 +25% maxMP (350k).
- **Utility/ochrona/resety:** dungeon_reset (50k, cap 5/dzień), boss_reset (80k, cap 5/dzień), death_protection zeruje karę śmierci (5M), amulet_of_loss chroni itemy (500k), stat_reset (10M), offline_training_boost (50k), utamo_vita magic shield (200k).

### 11.4a XP/skill boosty — zasada „chokepoint" (2026-07-16)

Eliksiry XP/skill (`xp_boost`, `xp_boost_100`, `premium_xp_boost`, `skill_xp_boost`, `skill_xp_boost_100`) mają **jeden punkt aplikacji mnożnika** — tak żeby działały wszędzie i nigdy nie liczyły się podwójnie:

- **Timer realtime:** te 5 eliksirów jest `pausable: false` → `expiresAt` liczony wall-clock, tyka od momentu użycia niezależnie od walki (dawniej pauzował poza walką).
- **Chokepoint XP postaci:** `characterStore.addXp(base)` mnoży przez `buffStore.getXpBoostMultiplier()` = (najlepszy z xp_boost_100 2.0 / xp_boost 1.5) × (premium_xp_boost 2.0). Zwraca `xpApplied` (faktycznie przyznane, po booście). **Każdy caller podaje BAZĘ** (bez eliksiru) i do wyświetlania używa `xpApplied`. Dotyczy: hunt, skip, dungeon, boss, raid, transform, offline, taski, questy, guild boss.
- **Chokepoint XP skilli:** `skillStore.addSkillXp(base)` mnoży przez `getSkillXpBoostMultiplier()` (skill_xp_boost_100 2.0 / skill_xp_boost 1.5) z **akumulatorem ułamkowym** (`skillXpFraction`) — bo w walce skill XP wpada po ~1/atak, a `floor(1×1.5)` gubiłby boost; reszta z zaokrąglenia przechodzi na następny grant.
- **Party/boss/raid:** do innych graczy broadcastowana jest **BAZA** (pre-eliksir), każdy członek aplikuje swój własny eliksir przez chokepoint → brak podwójnego stackowania eliksiru lidera i członka.
- **Offline hunt:** preview pokazuje wartości boostowane (display), a do `addXp`/`addSkillXp` idzie baza; skill ma osobne pole `skillXpGrant` (baza) obok `skillXpGained` (display).
- **Backend mode:** XP z walki/lochów/bossów liczy klient i commituje do blobu → boost działa. XP z questów/tasków liczonych po stronie Laravel wymaga analogicznego mnożnika w backendzie (patrz repo backendu).

### 11.5 Market

Podatek **5%** (`floor(price×0.05)`). Cena [1, 999 999 999], ilość [1, 999 999]. Kindy: item (nie stackowalny), potion/elixir/stone/arena_points/spell_chest (stackowalne). Escrow: wystawienie usuwa z inventory, anulowanie zwraca. Kup przez RPC `buy_market_listing` (atomowo, anty-duping). Niedostępne offline.

### 11.6 Sklep areny (AP)

Kamienie: common 50 AP, rare 200, epic 800, legendary 3000, mythic 6000, heroic 12 000. Miksturki: 25%/great 300 AP, 50%/ultimate 800, 100%/divine 2000. Mityczna broń/off-hand: `1000 × poziom` AP. Eliksiry: `max(50, floor(goldPrice/10))` AP.

---

## 12. Czary i umiejętności

Źródło: `skills.json` (110 skilli), `skillSystem.ts`, `skillStore.ts`, `skillEffectsV2.ts`, `combatEngine.ts`.

### 12.1 Struktura

- **110 skilli** = 105 aktywnych (7 klas × 15) + 5 weapon skills. Poziomy odblokowania: **5, 10, 20, 30, 40, 50, 60, 70, 80, 100, 150, 300, 600, 800, 1000**.
- Gracz ma **4 sloty aktywnych skilli** (ten sam skill nie w dwóch slotach).

### 12.2 Zdobywanie czarów — Spell Chest → unlock

Skille nie są dawane automatycznie — odblokowuje się je za **1 Skrzynię Czarów** (poziom = unlockLevel skilla) + złoto = `floor((100 × unlockLevel^1.8) / 5)`:

| unlockLevel | koszt złota | skrzynia |
|---|---|---|
| 5 | 362 | 1× lvl5 |
| 10 | 1 261 | 1× lvl10 |
| 50 | 22 560 | 1× lvl50 |
| 100 | 79 621 | 1× lvl100 |
| 1000 | ~7 962 143 | 1× lvl1000 |

### 12.3 Auto vs manual, MP, cooldown

- Tryb globalny `skillMode` (auto domyślnie). Auto-cast crit = 20%. Auto próg cooldownu `SKILL_COOLDOWN_MS = 8000` skalowany prędkością.
- MP: `getSkillMpCost` = `mpCost` z JSON, podłoga 15.
- `resolveSkillRecastMs`: shadow_step używa pełnego cooldownu z JSON (20000), reszta wspólnego progu.

### 12.4 Obliczenie obrażeń skilla

`damageMultiplier = atkDmg × spellDmg × transformDmg × skillDamage(JSON) × skillUpgradeMult`. AOE splash = 75% obrażeń primary. def_pen: efektywna obrona wroga = `floor(def × (1 − defPen))`, cap 60%.

### 12.5 Ulepszanie aktywnego skilla (Spell Chest)

`SPELL_CHEST_UPGRADE_TABLE`: target 1 (1 skrzynia/100g/100%), 2 (1/500/90%), 3 (2/1500/75%), 4 (3/5000/60%), 5 (4/15000/45%), 6 (5/50000/30%), 7 (7/150000/20%), 8 (10/500000/15%), 9 (15/1.5M/10%), 10 (20/5M/5%), >10: `20×2^(t−10)` skrzyń / `5M×2^(t−10)` / `max(0.1, 5×0.5^(t−10))`%. Porażka zużywa zasoby. Efekt w walce: `getCombatSkillUpgradeMultiplier` (§3.7).

### 12.6 Typy efektów (`skillEffectsV2.ts`)

Obrażeniowe: aoe, def_pen, dot, stun/paralyze, multistrike, mark_amp. Instant-kill: `instant_kill_chance` (burst 12% max HP), `execute_below` (dobicie <20%), `death_apocalypse` (12% max HP, necro na 20% HP). Self: heal_self, immortal, mana_shield, dodge/crit/dmg buffy. Party (Bard/Cleric/Knight): party_attack_up, party_as_up (mnożnik AS), party_defense_up, party_crit_up, party_def_pen, party_immortal, heal_party_*, revive_party. Summon (Necro): skeleton/ghost/demon/lich.

### 12.7 Przykładowe skille per klasa (unlockLevel, mp, cd, dmg×ATK)

- **Knight:** shield_bash (5, stun), whirlwind (20, aoe+aggro), execute (70, execute_below:25), absolute_cleave (1000, immortal:10000).
- **Mage:** fireball (5, dmg 6.6), meteor (60, aoe+stun), reality_rend (300, def_pen:50), big_bang (1000, aoe+stun+immortal).
- **Cleric:** heal (10, heal_lowest 20%), resurrection_aura (50, revive), celestial_heal (300, heal_party 60%), holy_apocalypse (1000, revive+immortal).
- **Archer:** precise_shot (5), sniper_shot (70, def_pen:60), death_arrow (100, instant_kill_chance:3), universe_arrow (1000, instant_kill:5).
- **Rogue:** backstab (5, crit_next), assassinate (50, execute_below:20), absolute_death (1000, instant_kill:8).
- **Necromancer:** summon_skeleton (10), army_of_darkness (80, ×5 szkielety), lich_transformation (800), death_apocalypse (1000).
- **Bard:** battle_hymn (5, party_atk 15%), divine_melody (150, party_as ×2), universe_song (1000, party_instant_kill+immortal+atk 100%).

### 12.8 Summony Necromanty (`necroSummonStore.ts`)

| Typ | Cap | dmgMult | HP/MP (× necro) |
|---|---|---|---|
| skeleton | 10 | 0.25 | 0.25 |
| ghost | 6 | 0.50 | 0.50 |
| demon | 2 | 1.20 | 1.00 |
| lich | 2 | 2.00 | 2.00 |

Sługi przyjmują obrażenia pierwsze (tank-wall) i dokładają obrażenia do ataków necro.

---

## 13. Poziom broni / Magic Level + trening

Źródło: `skillSystem.ts`, `skillStore.ts`.

- **Osobny system od per-monster mastery.** Każda klasa ma 1 weapon skill (Knight dodatkowo shielding). damageBonus/lvl: Knight sword 5%, Archer dist 6%, Rogue dagger 7%, magiczni (magic_level) 8%, Bard 4%. maxLevel 100. `getSkillDamageBonus = level × damageBonus` (sword lvl 50 = +250% DMG).
- **Zdobywanie:** klasy magiczne (Mage/Cleric/Necro) rosną Magic Level z ataków i castów; klasy broni (Knight/Archer/Rogue/Bard) rosną z ataków (+1 XP/atak); Knight shielding rośnie z bloków.
- **Krzywa XP skilla:** `skillXpToNextLevel(L) = ceil(100 × L^1.8)` (L≤0 → 100). L10→11 ~6310, L50→51 ~112 800, L100→101 ~398 107.
- **Kara śmierci:** 25% skumulowanego XP każdego skilla (może obniżyć poziom skilla).
- **Trening u Trenera + offline (do 24h).** Trenowalne staty: attack_speed (×0.1/lvl), max_hp/max_mp (+5), defense (+1), crit_chance (+0.5%), crit_dmg (+2%), hp_regen/mp_regen (× class rate). Offline: `offlineXpRate(lvl) = max(0.05, 2.0/(1+lvl×0.1))`, mnożniki prędkości per skill, aktywny gracz ×2.
- Rankingi weapon-skill: MLVL, Sword, Dagger, Dist, Bard, Shield, Boss (pseudo).

---

## 14. Bossowie

Źródło: `bossSystem.ts`, `bosses.json` (69 bossów).

- **69 bossów**, poziomy 10→1000. Wczesna gra gęsto (+5/+10/+15/+20), od L375 stały krok +25.
- **Mnożniki silnika:** HP ×3.5, ATK ×1.75, DEF ×1.3 (JSON = base). Cios = spread [0.8×, 1.2×] skalowanego ataku.
- **Enrage < 30% HP → obrażenia ×1.5.**
- **3 próby/dzień**, cooldown `86400/3 = 8h` (odnawialny „Reset Bossa"). Gate: `charLevel ≥ boss.level`. Rekomendowany poziom = `boss.level + 5`.
- **Nagrody (z poziomu, NIE z JSON):** `xp = floor(xpToNext(level) × (0.005 + 0.19/(1 + level/80)))` (~18% poziomu na L10, ~1.8% na L1000); `goldMid = floor(38 × level^1.8)`, zakres [0.6×, 1.6×]. Skalowane mastery bossa.
- **Loot:** boss ma `dropTable` (`{itemId, chance, rarity}`), roll per wpis tylko na wygranej. `heroicDropChance` per boss 0.01→0.18 (najwyższy na mid-tier, np. L25 Pan Cieni 0.18).
- **BALANS solo z miksturkami:** DPS-klasy próg ≈ **legendary+3** (~2-3 min), support (Bard/Cleric) ≈ **mythic+3**, rare+3 wolno, **heroic+7 szybko**. Cios bossa ≈ maxHp najsłabszej klasy / 7 (bez one-shotów).

Przykładowe staty (in-combat = base × mnożniki): L10 Król Kanałów 16 754 HP / 155 ATK; L100 Król Demonów 99 988 / 882; L500 Niebiański Niszczyciel 538 793 / 4091; L1000 Koniec Wszystkiego 1 063 324 / 8099.

---

## 15. Lochy

Źródło: `dungeonSystem.ts`, `dungeons.json` (77 lochów).

- **77 lochów**, poziomy 1→1000. Wszystko poza poziomem/maxRarity/dropTable liczone w kodzie.
- **Fale:** `max(3, min(10, floor(level/15) + 3))` — 3 na niskich, cap 10 (od L105). Ostatnia fala = boss lochu.
- **5 prób/dzień**, cooldown `86400/5 = 4.8h`. Gate: `charLevel ≥ dungeon.level`.
- **Skład fali (1–4 potwory):** boss wave 4 (L≥30) lub 3; regular `1 + floor((wave/(waves−1))×2)` (+1 przy L≥30, wave>0), clamp [1,4]. Typy: finalna L≤8 Epic / L≤18 Legendary / L≥19 Boss.
- **Mnożniki typu:** Normal 1/1/1, Strong 1.5/1.3/1.2, Epic 2.0/1.5/1.3, Legendary 3.0/1.8/1.5, Boss 5.0/2.5/2.0.
- **Loot:** drop chance boss wave 0.70, regular 0.15; rzadkość wg wag `[50,25,15,7,2.5,0.5]` obcięta do `maxRarity`; item level = poziom lochu.
- Flaga ukończenia `clearedDungeonIds` (trwała, przeżywa reset prób).

---

## 16. Rajdy

Źródło: `raidSystem.ts`.

- **Generowane z lochów** (77 rajdów, 1:1). Wymagają party. Lider startuje.
- **Fale wg poziomu:** ≤10 → 1, ≤50 → 2, ≤200 → 3, ≤500 → 4, >500 → 5. **4 boss-tier mobki/fala** (slots = fale × 4).
- **5 prób/dzień.** Bossy: `base = najwyższy monster ≤ raid.level`, `mult = (1 + gap×0.05)(1 + waveIdx×0.15)`, staty × BOSS_TIER (hp 10, atk 2.5, def 2.0).
- **Nagrody (per-member loot + shared XP), `RAID_REWARD_MULTIPLIER = 12`:** `xp = floor(base.xp×10) × bossów × 12 + (cleared ? level² : 0)`, gold analogicznie z `×15`. Item rarity per boss: heroic 0.5%, mythic 5%, legendary 10%, epic 20%, rare 50%, common 14.5%. Kamień per boss: heroic 1%, mythic 15%, legendary 25%, epic 40%, rare 10%, common 9%. Skrzynie: 0.25%/tier/boss. **Gwarantowany bonus item na pełny clear** (heroic 1.5% / mythic 8% / legendary 15% / epic 25% / rare 40% / common 10.5%).
- Niedostępne offline.

---

## 17. Transformacje

Źródło: `transformSystem.ts`, `transformBonuses.ts`, `transforms.json` (11 tierów).

### 17.1 11 tierów

| ID | Unlock | Zakres | Potworów do pokonania | Kolor |
|---|---|---|---|---|
| 1 | 30 | 1–30 | 30 | `#e53935` |
| 2 | 50 | 31–50 | 20 | `#ff9800` |
| 3 | 100 | 51–100 | 50 | `#4caf50` |
| 4 | 150 | 101–150 | 50 | `#8bc34a` |
| 5 | 200 | 151–200 | 50 | `#9c27b0` |
| 6 | 300 | 201–300 | 100 | `#5c6bc0` |
| 7 | 500 | 301–500 | 200 | `#212121` |
| 8 | 700 | 501–700 | 200 | gradient |
| 9 | 800 | 701–800 | 100 | `#2196f3` |
| 10 | 900 | 801–900 | 100 | `#ffffff` |
| 11 | 1000 | 901–1000 | 100 | gradient |

Sekwencyjne (T(N) po T(1..N−1) + `charLevel ≥ level`). Fala 4 slotów: Normal/Strong/Epic/Boss.

### 17.2 Skalowanie potwora

```
capstone = level >= 901 ? 3.5 : 1        // T11 spike
hp = floor((95 × level^1.1 + 30) × capstone)
attack = floor(8 + level)
defense = floor(level × 0.4)
```

Mnożniki tieru: Normal 1/1/1, Strong 2.0/1.5/1.3, Epic 4.0/2.5/1.8, Boss 5.0/3.0/3.0. `TRANSFORM_BOSS_MULTIPLIER = {hp:5, atk:3, def:3}`. **T11 (L901–1000) z capstone ×3.5 HP = najtrudniejsza walka w grze (cel ~mythic+7, ~6 min).**

### 17.3 Trwałe bonusy per klasa (KOD, nie JSON!)

`transforms.json rewards.permanentBonuses` (identyczne dla wszystkich tierów) jest **ignorowane**. Gra używa `CLASS_TRANSFORM_BONUSES` (base = tier 1):

| Klasa | dmg% | hp% | mp% | def% | atk% | flatHp | flatMp | +ATK | +DEF |
|---|---|---|---|---|---|---|---|---|---|
| Mage | 8 | 2 | 3 | 1 | 0 | 150 | 400 | 13 | 3 |
| Cleric | 5 | 3 | 3 | 2 | 0 | 220 | 380 | 10 | 10 |
| Necromancer | 7 | 2 | 3 | 1 | 0 | 180 | 380 | 12 | 5 |
| Archer | 7 | 2 | 1 | 1 | 7 | 220 | 150 | 0 | 5 |
| Rogue | 7 | 2 | 1 | 1 | 0 | 190 | 150 | 15 | 4 |
| Bard | 5 | 3 | 3 | 2 | 0 | 230 | 260 | 10 | 9 |
| Knight | 3 | 4 | 1 | 3 | 0 | 420 | 70 | 9 | 16 |

Skalowanie tieru `1 + (transformId−1)×0.3` (T11 = ×4.0) aplikowane TYLKO do flatów. Procenty stackują additively przez wszystkie ukończone transformacje.

### 17.4 Nagrody ukończenia (per transformacja)

Mityczna broń klasy (poziom = transform.level) + Premium XP Elixir ×5 + miksturki HP/MP (rosnące per tier, np. T11 divine ×500) + skrzynia czarów + 1 mityczny kamień. Zmiana awatara na `<class>-<tier>.png` (kosmetyczne, najwyższy tier). Postęp questa przeżywa ucieczkę.

---

## 18. Trener

Źródło: `Trainer.tsx`.

Nieśmiertelne manekiny (1–4), HP nigdy nie spada (sandbox HP/MP nie zapisywany). Licznik DPS = najlepsze 5-sekundowe okno (`best_dps5_solo`/`best_dps5_party`). **Brak XP/złota/dropów/mastery.** Auto-miksturki zawsze on. **Kara za ucieczkę NADAL się nalicza** (`applyFleePenalty`). Przełączniki: trener atakuje, bez cooldownów. Tempo 1/2/4 (bez SKIP).

---

## 19. Arena (PvP)

Źródło: `arenaSystem.ts`, `arenaStore.ts`.

- **10 ataków/dzień.** Lobby 100 przeciwników (gracz + boty). Sezon tygodniowy (poniedziałek 00:00 UTC → poniedziałek).
- **9 lig** (mnożnik = index+1): bronze 1×, silver 2×, gold 3×, platinum 4×, emerald 5×, diamond 6×, master 7×, grand_master 8×, legend 9×. Awans/spadek na koniec sezonu wg `promotedTop`/`relegatedBottom`.
- **LP** (League Points) = ranga w lidze + awans/spadek. **AP** (Arena Points) = waluta sklepu areny. Atakowalni = ±2 rangi.
- **Nagrody meczu:** wygrana wyżej-rankingowany 200 AP / +2 LP; wygrana upset 100 AP / +1 LP; **przegrany atakujący nic nie traci** (obrońca dostaje 250 AP / +1-2 LP).
- **Walka snapshot-based:** migawka obrony przeciwnika, `ARENA_DAMAGE_MULTIPLIER = 0.2` (−80%, mecz ~10+ wymian), atak co 2 ticki.
- **Nagrody sezonowe** (× mnożnik ligi): rank 1 = 1000 AP / 100k gold / 10 mythic / 20 legendary / ...; malejąco do rank 51–100 = 50 AP / 5k gold.

---

## 20. Party

Źródło: `partySystem.ts`, `partyApi.ts`.

- **Max 4 osoby.** Publiczne/prywatne, min_join_level. GC pustego party > 30s, dowolnego > 6h.
- **Mnożniki per członek:** drop +0.5%, XP +6.5%, difficulty +20%. (size 4 → drop ×1.015, XP ×1.26, difficulty ×1.6.)
- **Bonus kompozycji (unikalne klasy):** ≥4 → ×1.20, ≥3 → ×1.10 (XP+gold, stackuje z size).
- **Class buffy:** Cleric `cleric_heal` 15% maxHP/turę (3 tury), Bard `bard_atk` +10% ATK (5 tur), Knight `knight_def` +10% DEF (5 tur).
- **Podział XP/gold:** równy `floor(total / size)`.
- **Aggro weights:** Knight 80, Rogue 60, Archer 50, Necromancer 40, Mage 30, Cleric 20, Bard 20.
- **Boty:** wypełniają puste sloty (priorytet Cleric→Knight→Mage→Archer), poziom = średnia party, blokowane offline.
- Level gate: MIN po wszystkich ludziach (niski gracz blokuje wyższy content).
- Ready-check 60s, presence heartbeat 2s. Niedostępne offline.

---

## 21. Gildia

Źródło: `guildSystem.ts`, `guildBossSpells.ts`.

- **Koszt założenia: 1 000 000 złota.** Cap = `20 + max(0, level−1)` (+1/poziom). Tag 2–3 znaki A-Z0-9. Bez ceiling poziomu.
- **Boss tygodniowy tier 1–50:** `HP = floor(2 000 000 × 1.25^(tier−1))` (tier 1 = 2M, tier 10 = ~14.9M, tier 50 = ~112 mld). **Obrażenia/cios: `max(charAttack) × (1 + level/120) × (1 + (tier−1)×0.05)`, cap = 5% maxHP bossa (ROSNĄ +5%/tier).**
- **XP gildii:** 1 HP obrażeń = 1 XP. `guildXpToNextLevel(L) = floor(L × getGuildBossMaxHp(clamp(L)))`.
- **Tydzień:** poniedziałek 00:00 UTC. **Niedziela = dzień odbioru** (walka zablokowana).
- **Mnożnik nagrody za wkład:** `max(0.05, 0.1 + share×1.9)` (share = obrażenia/maxHP; 100% → ×2.0). Skaluje gold/XP/kamienie/miksturki/szansę na drop.
- **Zestaw czarów bossa (50 tierów):** interwał castu 3700 ms (tier 1) → 700 ms (tier 50, podłoga 250 ms), mnożnik obrażeń 0.95 → 24.10, `damage = floor(playerMaxHp × spell.dmgPct × kit.mult)`.
- Skarbiec 1000 slotów, log 200 najnowszych. Czat gildii cap 500 wiadomości. Sukcesja lidera z żywych członków, brak systemu rang.

---

## 22. Czat i Znajomi

- **Kanały:** city (globalny, nigdy nie trymowany), system (`[SYS]{json}`), party, guild (cap 500), PM (cap 100). Input max 300 znaków. Realtime + polling 4s.
- **Online:** `updated_at` < 5 min. Unread badge czyszczony na dowolne kliknięcie ikony, ukryty offline.
- **Znajomi (per-postać, local-only):** add/PM/block/favorite. Blok = jednostronne wyciszenie (Ty wciąż piszesz). Sort: ulubieni → online → alfabetycznie. Refresh online co 60s.

---

## 23. Offline hunt i tryb offline

Źródło: `offlineHuntStore.ts`, `offlineHuntSystem.ts`, `connectivityTransitions.ts`.

### 23.1 Offline hunt („Offline Trening")

- **10 s/kill baza**, cap **12h**. Mnożnik prędkości wg mastery: 0–4 ×1, 5–11 ×2, 12–19 ×3, 20+ ×4.
- Preview deterministyczny; claim roluje per-kill (rzadkość + dropy przez live systemy). Rarity XP/gold mult offline: normal 1, strong 1.5, epic 2.5, legendary 4, boss 8. Kill-weights tasków = **1/3/10/50/200** (jak wszędzie; inline 1/2/5/10/20 w File 07 było stale).
- `kills ≤ 0` przy claim → brak nagrody.

### 23.2 Tryb offline

- **Działa offline:** /combat, /dungeon, /boss, /transform, /trainer, /offline-hunt.
- **Blokowane (OnlineOnlyGuard):** /leaderboard, /party, /market, /deaths, /chat, /friends, /social, /raid, /arena.
- Anty-duplikacja: sesja podejrzana gdy `levelGained ≥ 20` LUB `gold > snap×50` LUB `items > snap×10` (log/warn, nie blok). Save offline pomija debounce (natychmiastowy zapis do localStorage).

---

## 24. Postać: tworzenie i wybór

Źródło: `CharacterCreate.tsx`, `meta-auth-offline.md`.

- **Max 7 postaci/konto** (CLAUDE.md „5" jest stale). 7 klas. Starter gold = 0, stat_points = 0. Bez weryfikacji email. Nick: `[a-zA-Z0-9]` + max 1 spacja, 3–18 znaków, bez polskich znaków.
- **Staty startowe** — patrz §2.1. **Bronie startowe** (`CharacterCreate STARTER_WEAPONS`, to co jest zakładane): Knight sword_of_beginnings (4–8), Mage apprentice_staff (3–6), Cleric wooden_mace (3–7), Archer short_bow (4–8), Rogue rusty_dagger (3–7), Necromancer bone_staff (3–6), Bard lute (3–6). (`itemTemplates.json starterWeapons` — inny, nieużywany zestaw; patrz §29.)

---

## 25. Rankingi

**30 zakładek, top 100, medale top 3.** Kategorie: level (1) · weapon/training skille (2–14: MLVL, Sword, Dagger, Dist, Bard, Shield, AS, HP, MP, HP Reg, MP Reg, DEF, Crit%) · crit dmg (15) · boss score (16) · arena (17–19: zabójcy, ofiary, liga) · gildie (20) · śmierci (21) · mastery (22) · questy/daily (23–24) · market sprzedaż/zakupy (25–26) · ulepszenia/skill up (27–28) · DPS solo/party (29–30). Wrapped w OnlineOnlyGuard.

---

## 26. Miasto

Źródło: `Town.tsx`.

- **Odpoczynek:** darmowy pełny heal HP+MP do efektywnego max, animacja **10 s**, tylko w mieście, zablokowany w walce.
- **7 kafelków:** Offline Trening (`/offline-hunt`, pokazuje `{h}h {mm}m / 12h`), Depozyt, Market (offline off), Potwory, Odpoczynek, Rankingi (offline off), Śmierci (offline off).
- **BottomNav (6):** Walka (`/battle`), Questy (`/quests`, pulsująca kropka claim), Postać (`/inventory`), Miasto (`/`), Społeczność (`/social`, offline off), Sklep (`/shop`). Ukryty podczas HUD walki.

---

## 27. Śmierć i kary

Źródło: `levelSystem.ts`, `deathProtection.ts`, `combatLeavePenalty.ts`.

- **Kara śmierci:** utrata poziomów = `max(0.20, level/100)` (L50 = 0.5, L100 = 1, L200 = 2, L1000 = 10) na osi „exact position" + **25% skill XP** + strata itemów tylko przy `level > 50` (5% plecaka, min 1). Statystyki z poziomów NIE znikają.
- **Kara ucieczki:** `10% kary śmierci` (L100 = 0.1, L1000 = 1) + **2.5% skill XP**, NIGDY nie zabiera itemów.
- **Ochrona:** jeden item (`death_protection` first, potem `amulet_of_loss`) zeruje CAŁĄ karę.
- **Zamknięcie karty w walce** = pełna kara śmierci, **pomija ochronę** (anti-cheat), logowane jako „fled".

---

## 28. Balans — cele projektowe

Źródło: `scripts/balance/calibrate.mjs`, `calibrateContent.mjs`.

- **Common+0 na swój poziom** ubija: normal 5–10, strong 3–8, epic 2–5, legendary 1–3, boss 0–1 (DPS góra, tank/support dół).
- **Skalowanie gearu:** +1 ulepszenie ≈ +10% zabić, +1 rarity ≈ +15%, heroic ≈ +105% (statMult 2.05).
- **Strefa startowa L≤10** ubijalna bez gearu (cel 5–7 zabójstw szczura/klasę bez potek). Żaden potwór nie one-shotuje common+0.
- **Bossy solo z potkami:** DPS ≈ legendary+3, support ≈ mythic+3, heroic+7 szybko. Cios bossa ≈ maxHp najsłabszej klasy / 7.
- **Guild boss** clearowalny na każdym tierze (obrażenia rosną z tierem).

---

## 29. Rozbieżności kod ↔ dokumentacja

Wykryte przez ekstrakcję + audyt adwersarialny (kod/dane zawsze wygrywają):

| Temat | Dokumentacja/JSON mówi | Kod (autorytatywny) |
|---|---|---|
| Krzywa XP | `100·L^1.6` | `max(300, 300·L^1.5)` <100 + kotwice + 1.10^overflow |
| Punkty statystyk/poziom | +1 do +3 | flat **2** |
| Przyrost HP/MP per poziom (`classes.json`) | Knight 15/3 | Knight **8/2** (`levelSystem`) |
| Staty startowe ATK/DEF (`classes.json`) | Knight 25/20 | efektywnie **10/5** (`CharacterCreate`; classes.json ATK/DEF nigdy nie aplikowane, HP/MP floorowane do 200/50) |
| Pasywna regen MP | 0.5%/s zawsze | **nie istnieje** (0 gdy brak treningu) |
| Progi/wpisy tasków | 6 progów, 540 wpisów | **10 progów, 600 wpisów, 60 potworów** |
| Kill-weights task/mastery | 1/2/5/10/20 | **1/3/10/50/200** (wszędzie, też offline hunt) |
| Daily quest | 3/dzień | **12/dzień** |
| Skill XP loss przy śmierci | 50% (`tutorial` — usunięty) | **25%** (flee 2.5%) |
| Kara śmierci poziomów | `floor(level·0.02)` | ciągłe `max(0.20, level/100)` |
| Mnożnik ulepszenia | `1.15^U` | LINIOWE `1 + 0.10·U` |
| Konwersja potek tier 3 | 4× | **334×** (lg→great) |
| Cooldown potek | flat 5s / pct 2s | **1s / 0.5s** |
| Bonus sloty heroic (`items.json`) | 0 | **5** |
| Guild boss HP/dmg (`social.md`) | 15M·1.55, dmg ÷1.15/tier | **2M·1.25^(t−1)**, dmg **+5%/tier** |
| Max postaci (CLAUDE.md prose) | 5 | **7** |
| Max party (CLAUDE.md prose) | 8 | **4** |
| Bossy „co 25 lvl" | co 25 | mieszane <375, +25 od 375 (69 bossów) |
| Trzy tabele rarity XP/gold | jedna | hunt boss ×30/30, raid ×10/15, offline ×8/8 |
| Bronie startowe | `itemTemplates.json starterWeapons` | `CharacterCreate STARTER_WEAPONS` (inny zestaw; itemTemplates nieużywany) |
| Monster crit | brak | latentne 5% (`calculateDamage` default) |

---

## 30. Reguła utrzymania (OBOWIĄZKOWE)

**Po KAŻDEJ zmianie backendu LUB frontu, która dotyka mechaniki gry, MUSISZ w tym samym zadaniu:**

1. **Zaktualizować ten dokument** (`docs/GAME_DESIGN.md`) — nowe/zmienione formuły, liczby, drop-rate, balans, koszty, progi, nowy feature (nowa sekcja).
2. **Zaktualizować player-facing Wiki** — `src/data/wiki.ts` (treść) i w razie potrzeby `src/views/Wiki/Wiki.tsx` (struktura). Wiki opisuje ogólnie, ten dokument szczegółowo.
3. **Zaktualizować `CLAUDE.md`** — jeśli zmiana dotyka core rules / liczb / list w CLAUDE.md, oraz odpowiedni `.claude/spec/<domena>.md`.
4. **Nowy feature** = opisać go i tutaj, i na Wiki, i w CLAUDE.md/spec. To jest część definicji „gotowe" — bez aktualizacji dokumentacji zmiana jest niedokończona.

Kolejność: kod → ten dokument + wiki + CLAUDE.md/spec → testy → bump wersji. Przestarzała dokumentacja jest gorsza niż żadna (wprowadza w błąd). Ta reguła jest też zapisana w pamięci projektu i w CLAUDE.md.
