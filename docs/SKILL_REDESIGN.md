# Skill Redesign — working reference (rebalans 2.0)

Dokument roboczy do sesji „klasa po klasie, skill po skillu". Zawiera: (1) proponowany
FRAMEWORK (model dmg / TTK / cooldown / upgrade) do uzgodnienia, (2) pełny stan OBECNY
każdego skilla, (3) wykryte problemy, (4) miejsce na PROPOZYCJE (uzupełniamy razem).

Status: Etap 1 (baza statów) i Etap 2 (%-DEF + usunięcie bloku/uniku) — ZROBIONE, zielone.
Ten dokument = wejście do Etapu 3 (skille). Liczby wpisujemy DOPIERO po uzgodnieniu.

---

## 1. Jak DZIŚ liczony jest dmg skilla (fakt z kodu)

`calculateDamage` (`combat.ts`) wołane z auto-castu (`combatEngine.ts:1291`):
```
baseDamage  = (char.attack + weaponRoll + floor(char.attack*0.5)) * classMod
mitigated   = baseDamage * (1 - defMitigation(def, char.level))         // NOWE %-DEF (Etap 2)
finalDamage = max(1, mitigated)  → if crit(20%) ×2.0  → × damageMultiplier → floor
damageMultiplier = atkElixir · spellElixir · transformDmg · SKILLdmgCoeff · upgradeMult
```
- `damage` w `skills.json` = **czysty mnożnik na cały cios** (Fireball 6.6 = ×6.6). `damage:0` = brak ciosu (utility/buff/summon).
- `classMod`: Knight 1.0 · Mage 1.3 · Cleric 1.0 · Archer 1.2 · Rogue 1.0 · Necro 1.2 · Bard 1.0.
- Skill crit = stałe 20% (cap maxCrit klasy), ×2.0.
- `upgradeMult` = `getCombatSkillUpgradeMultiplier(U) = 1 + min(U,10)·0.02 + max(0,U−10)·0.01` (U30→×1.40; SŁABE — patrz framework).

## 2. PROPONOWANY FRAMEWORK (do uzgodnienia PRZED liczbami)

Cel właściciela: skille odczuwalne i satysfakcjonujące, ale **rotacja NIE kasuje TTK** (mob 6–9 s, boss 3–4 min);
opisy pokazują dokładny dmg; upgrade w nieskończoność ma sens ale nie rozwala gry.

**(A) Model dmg skilla — HYBRYDA baza + atak, podział 50/50 (decyzja właściciela 2026-07-19):**
```
spell = ( BAZA(skillLevel/charLevel, U)  +  0.5·atak ) · classMod · rangeRoll  → %-DEF → crit(A) → elixiry/transform
```
- **BAZA (~50%)** — własny dmg czaru, NIEZALEŻNY od gearu; rośnie z poziomem + upgrade. Ulepszony/odblokowany skill bije sensownie nawet bez topgearu.
- **0.5·atak (~50%)** — część skalująca się z gearem (atak zawiera gear). Podział 50/50 (do ew. tuningu per klasa).
- **rangeRoll** = ± % (spell rolluje RANGE, nie stała wartość). **Upgrade podnosi BAZĘ (min i max)**, malejąco do capa (model C).
- Przy typowym gearze spell ≈ **1.2–2.0× zwykłego ciosu**; słabszy gear → spell relatywnie mocniejszy (baza dominuje).
- **Crit = OPCJA A** — osobno (20% × 2.0 jak dziś). Max cios spella ≈ 2× × crit ≈ ~4× zwykłego ciosu (rzadko, jak zwykłe ciosy).
- `classMod` różnicuje klasy (Mage ×1.3 → mocniejsze spelle z automatu). Zastępuje stary `damage`-coeff + `getCombatSkillUpgradeMultiplier`.
- **Mnożniki „×zwykły cios" w tabelach niżej = docelowy stosunek przy TYPOWYM gearze** (mechanika pod spodem = baza+atak, nie sztywny mnożnik).

**(B) TTK ze skillami — KLUCZ (rozwiązanie problemu „4 skille × 100 = one-shot"):**
```
effectiveDPS = basicDPS + Σ_slots (avg_skill_hit / cooldown_s)
```
Kalibracja HP mobów/bossów/lochów/transformów/raidów liczona wobec `effectiveDPS` (pełna rotacja, nie sam basic).
**Dźwignie per skill:** (1) niższy `BASE_power`, (2) DŁUŻSZY cooldown (burst co N s), (3) więcej HP contentu.
Proponuję **budżet DPS ze skilli ≈ 40–60% całości** (reszta = basic), żeby skille „robiły robotę" ale walka trwała.

**(C) Cooldown = główny regulator burstu.** Proponowane pasma (tuning per skill):
- spam / filler (mały dmg): 5–8 s
- średni: 12–20 s
- mocny burst: 30–45 s
- ultimate / instakill / immortal: 60–180 s
Silniejszy skill → dłuższy CD, żeby `skill_dmg/cooldown` (jego wkład w DPS) był kontrolowany.

**(D) Upgrade w nieskończoność — malejące przyrosty (żeby nie było runaway):**
- **DMG skille:** przyrost malejący, np. `upgradeMult(U) = 1 + K·(1 − r^U)` (asymptota ~×2.5–3.0). Każdy kolejny
  poziom dodaje CORAZ mniej → nieskończony upgrade daje sens, ale bounded. (Alternatywa: liniowy +X dmg/level z twardym udziałem — do wyboru.)
- **BUFF/utility skille:** DZIŚ upgrade NIE robi nic (bug — patrz problem #10). Ustalić per skill co poprawia upgrade
  (np. +% siły buffa / +% trwania / −% cooldown / +% def-pen) i cap. Proponuję: małe przyrosty (+1–2%/lvl) z capem.

**(E) Nazwy + opisy = adekwatne do mechaniki (decyzja właściciela 2026-07-19).** KAŻDY skill (nie tylko „instant killy"):
- **nazwa** ma odzwierciedlać co realnie robi (koniec mylących „Instant Kill" które dają 12% HP itd.),
- **opis** generowany z (A): „X–Y dmg (+efekt)" — koniec rozjazdu opis↔realny dmg.
Źródła: `skills.json` name_pl/name_en + description, UI castu (Combat/Boss/Dungeon/Raid/Transform/Arena), `wiki.ts`, tooltipy upgrade (`Inventory.tsx`).

## 3. Wykryte problemy do decyzji (z audytu kodu)

1. **`weaponSkills.damageBonus` (0.04–0.08) = MARTWE DANE.** Realnie combat używa hardcoded `getClassSkillBonus`
   (`itemSystem.ts:790`): Knight sword×0.5, Mage/Necro mlvl×0.8, Cleric×0.6, Archer dist×0.4 (+crit), Rogue×0.3 (+crit), Bard×0.5. → ujednolicić.
2. **Bard `party_instant_kill_chance_next` = no-op** w polowaniu (konsumowane tylko w martwej ścieżce `resolveBasicAttack`).
3. **`mark_no_heal` == `mark_heal_to_dmg`** (identyczne — oba tylko `markNoHealMs`). Rogue „Marked for Death" = zwykłe no-heal.
4. **`dot:MS:B` → B to % HP/s, NIE liczba ticków.** `dot:5000:5` = ~5% max HP/s przez 5 s (~25% HP). To MOCNY % DoT — do kalibracji.
5. **`heal_self_max_pct` — token martwy** (żaden skill go nie używa).
6. **`instant_kill_chance` NIE zabija** — daje `max(dmg, 12% maxHp)`. Tylko `execute_below` to prawdziwy kill (poniżej progu). Nazwy „Instant Kill/Death Touch" mylą.
7. **Cleric `revive_party:0:0` (Resurrection Aura)** — wskrzesza boty do 50% ale BEZ okna ochrony (nazwa myli).
8. **Skill-cast `skillBonus` = flat `floor(atk·0.5)`** — ignoruje poziom weapon-skilla (basic go używa, skille nie).
9. **Cleric id↔nazwa poprzestawiane** (np. id `holy_judgment` pokazuje „Apocalypse Prayer") — pułapka przy edycji po id.
10. **`damage:0` (buffy) NIE dostają upgrade-multa** — upgrade buffa nie robi w walce nic (patrz framework D).

## 4. STAN OBECNY per klasa (id · L=unlock · dmg=coeff · MP · CD ms · efekt)

### KNIGHT (11 dmg / 4 utility · classMod 1.0)
- shield_bash L5 · 5.4 · 15 · 8000 · stun:3000
- battle_cry L10 · 0 · 20 · 15000 · party_attack_up:20:5000
- whirlwind L20 · 5.4 · 25 · 12000 · aoe;aggro_steal
- fortify L30 · 0 · 30 · 20000 · party_defense_up:30:8000
- berserker_rage L40 · 5.4 · 40 · 25000 · attack_up:50:6000
- iron_defense L50 · 0 · 35 · 22000 · party_defense_up:50:10000
- charge L60 · 9 · 50 · 30000 · stun:2000
- execute L70 · 9 · 60 · 35000 · execute_below:25 (PRAWDZIWY kill ≤25% HP)
- war_cry L80 · 0 · 70 · 40000 · party_attack_up:30:15000
- ultimate_slash L100 · 9 · 100 · 60000 · crit_next:1:1
- sword_mastery L150 · 9 · 80 · 45000 · dot:5000:5
- titan_cleave L300 · 9 · 120 · 70000 · aoe;def_pen:40
- divine_strike L600 · 12.6 · 150 · 90000 · aoe
- god_slash L800 · 12.6 · 200 · 120000 · aggro_steal;crit_next:1:1;dmg_amp_next:5:1
- absolute_cleave L1000 · 12.6 · 300 · 180000 · immortal:10000

### MAGE (13 dmg / 2 utility · classMod 1.3 — najsilniejszy nuker)
- fireball L5 · 6.6 · 20 · 5000 · (plain)
- ice_lance L10 · 6.6 · 25 · 6000 · (plain)
- thunder_strike L20 · 6.6 · 35 · 10000 · aoe
- mana_shield L30 · 0 · 40 · 30000 · mana_shield:20000
- arcane_bolt L40 · 6.6 · 45 · 8000 · dmg_amp_next:3:1
- blizzard L50 · 6.6 · 60 · 20000 · aoe
- meteor L60 · 11 · 80 · 30000 · aoe;stun:3000
- time_warp L70 · 0 · 70 · 35000 · party_as_up:1.5:8000
- arcane_explosion L80 · 11 · 90 · 40000 · aoe
- apocalypse_spell L100 · 11 · 150 · 60000 · aoe;immortal:5000
- void_ray L150 · 11 · 120 · 50000 · heal_self_pct_dmg:30
- reality_rend L300 · 11 · 180 · 80000 · aoe;def_pen:50
- singularity L600 · 15.4 · 220 · 100000 · paralyze:5000
- god_nova L800 · 15.4 · 280 · 150000 · aoe;heal_self_pct_dmg:50
- big_bang L1000 · 15.4 · 400 · 200000 · aoe;stun:10000;immortal:10000

### CLERIC (9 dmg / 6 heal · classMod 1.0 — niskie coeffy 3/5/7)
- holy_strike L5 · 3 · 18 · 6000 · heal_self_pct_dmg:50
- heal L10 · 0 · 25 · 8000 · heal_lowest_ally_pct:20
- divine_shield L20 · 0 · 30 · 40000 · block_next_party:1
- smite L30 · 3 · 40 · 15000 · aoe;stun_chance:30:3000
- blessing L40 · 0 · 50 · 30000 · heal_party_dot:10000:5
- resurrection_aura L50 · 0 · 80 · 120000 · revive_party:0:0
- holy_nova L60 · 5 · 60 · 25000 · aoe;heal_lowest_ally_pct:20
- consecration L70 · 5 · 70 · 35000 · aoe
- divine_intervention L80 · 0 · 100 · 60000 · next_ally_heal:7.5:3
- holy_judgment L100 · 5 · 120 · 50000 · aoe;def_pen:60
- divine_wrath L150 · 5 · 150 · 70000 · party_lifesteal_next:100:5
- celestial_heal L300 · 0 · 200 · 90000 · heal_party_pct:60
- apocalypse_prayer L600 · 7 · 250 · 120000 · aoe;def_pen:60;heal_party_pct:30
- divine_pillar L800 · 7 · 300 · 150000 · aoe;party_immortal:5000
- holy_apocalypse L1000 · 7 · 500 · 240000 · aoe;party_immortal:5000;revive_party:5000:10000

### ARCHER (12 dmg / 3 utility · classMod 1.2)
- precise_shot L5 · 6 · 10 · 5000 · crit_buff_next:30
- poison_arrow L10 · 6 · 15 · 8000 · dot:5000:5
- eagle_eye L20 · 0 · 20 · 18000 · crit_buff:30:10000
- rain_of_arrows L30 · 6 · 30 · 15000 · aoe
- trap L40 · 0 · 25 · 20000 · stun:3000
- multishot L50 · 6 · 40 · 15000 · multistrike:3
- wind_arrow L60 · 10 · 35 · 12000 · stun:3000
- sniper_shot L70 · 10 · 60 · 35000 · def_pen:60
- shadow_step L80 · 0 · 50 · 20000 · dodge_next:3 (aktywny skill — ZOSTAJE)
- death_arrow L100 · 10 · 100 · 60000 · instant_kill_chance:3
- celestial_arrow L150 · 10 · 120 · 50000 · aoe
- void_shot L300 · 10 · 180 · 80000 · aoe;def_pen:60
- god_arrow L600 · 14 · 220 · 100000 · dmg_amp_next:2:8
- destiny_shot L800 · 14 · 280 · 150000 · instant_kill_chance:4
- universe_arrow L1000 · 14 · 400 · 200000 · aoe;instant_kill_chance:5

### ROGUE (12 dmg / 3 utility · classMod 1.0)
- backstab L5 · 6 · 15 · 6000 · crit_next:1:1
- poison_blade L10 · 6 · 20 · 10000 · dot:5000:5
- evasion L20 · 0 · 25 · 18000 · dodge_next:3 (aktywny — ZOSTAJE)
- dual_strike L30 · 6 · 30 · 8000 · stun_chance:50:3000
- smoke_bomb L40 · 0 · 35 · 25000 · dodge_buff:50:4000 (aktywny — ZOSTAJE)
- assassinate L50 · 6 · 50 · 30000 · execute_below:20 (PRAWDZIWY kill ≤20%)
- hemorrhage L60 · 10 · 40 · 20000 · dot:8000:4
- shadow_clone L70 · 10 · 70 · 40000 · dmg_amp_next:2:1
- marked_for_death L80 · 0 · 60 · 35000 · mark_heal_to_dmg:6000
- instant_kill L100 · 10 · 120 · 60000 · instant_kill_chance:3
- shadow_death L150 · 10 · 150 · 70000 · aoe
- void_strike L300 · 10 · 200 · 90000 · def_pen:60
- death_touch L600 · 14 · 250 · 120000 · instant_kill_chance:5
- god_assassin L800 · 14 · 300 · 160000 · aoe;def_pen:60
- absolute_death L1000 · 14 · 450 · 300000 · instant_kill_chance:8;dodge_next:1

### NECROMANCER (8 dmg / 7 summon · classMod 1.2)
- life_drain L5 · 5.7 · 20 · 6000 · heal_self_pct_dmg:30
- summon_skeleton L10 · 0 · 40 · 20000 · summon:skeleton:1
- death_curse L20 · 0 · 30 · 15000 · mark_amp:6:1:15000
- bone_spear L30 · 5.7 · 35 · 10000 · aoe
- plague L40 · 5.7 · 50 · 25000 · aoe;dot:5000:5
- raise_dead L50 · 0 · 60 · 30000 · summon:ghost:1
- soul_harvest L60 · 9.5 · 70 · 35000 · aoe;heal_self_pct_dmg:50
- dark_ritual L70 · 0 · 80 · 40000 · dark_ritual:10000:25 (bomba 25% HP celu po 10 s)
- army_of_darkness L80 · 0 · 100 · 60000 · summon:skeleton:5
- death_coil L100 · 9.5 · 120 · 50000 · stun:3000
- apocalypse_rise L150 · 9.5 · 150 · 70000 · summon:demon:1
- death_realm L300 · 9.5 · 200 · 100000 · aoe;mark_amp_all:2:5000
- soul_storm L600 · 13.3 · 260 · 130000 · aoe;summon:ghost:3
- lich_transformation L800 · 0 · 300 · 160000 · summon:lich:1
- death_apocalypse L1000 · 0 · 500 · 300000 · death_apocalypse (12% HP celu);summon:skeleton:1

### BARD (5 dmg / 10 buff · classMod 1.0 — support)
- battle_hymn L5 · 0 · 20 · 12000 · party_attack_up:15:10000
- lullaby L10 · 0 · 25 · 15000 · enemy_atk_down:25:8000
- ballad_of_heroes L20 · 0 · 35 · 20000 · party_as_up:1.5:12000
- dissonance L30 · 3 · 30 · 18000 · stun_chance:35:3000
- war_song L40 · 0 · 45 · 25000 · party_crit_up:30:12000
- heroic_ballad L50 · 0 · 60 · 30000 · party_def_pen:40:10000
- requiem L60 · 5 · 55 · 28000 · aoe
- sirens_call L70 · 0 · 70 · 35000 · aoe;enemy_no_heal:5000
- epic_saga L80 · 5 · 90 · 45000 · party_attack_up:40:15000
- legends_anthem L100 · 0 · 120 · 60000 · party_immortal:3000
- divine_melody L150 · 0 · 150 · 70000 · party_as_up:2:10000;party_attack_up:40:10000
- song_of_doom L300 · 5 · 200 · 100000 · aoe;party_attack_up:20:20000
- cosmic_hymn L600 · 0 · 260 · 130000 · party_immortal:8000
- god_ballad L800 · 7 · 320 · 180000 · aoe;party_attack_up:50:30000
- universe_song L1000 · 0 · 500 · 300000 · party_instant_kill(no-op);party_immortal:3000;party_attack_up:100:30000;party_as_up:2.2:10000

### WEAPON SKILLS (real combat effect = getClassSkillBonus, NIE damageBonus z JSON)
- sword_fighting (Knight) → +sword_fighting×0.5 atk/hit
- distance_fighting (Archer) → +dist×0.4 atk +0.003 crit/lvl
- dagger_fighting (Rogue) → +dagger×0.3 atk +0.005 crit/lvl
- magic_level (Mage/Cleric/Necro) → +mlvl×0.8 (Cleric ×0.6) atk/hit
- bard_level (Bard) → +bard×0.5 atk/hit
- shielding (Knight, 6-ty) → +floor(level/2) DEF (NOWE Etap 2: to teraz płaski DEF zamiast bloku)

## 5. PROPOZYCJE (uzupełniamy razem, klasa po klasie)

### KNIGHT — UZGODNIONE (2026-07-19). Model: spell = zwykły cios × mnożnik(range). Upgrade podnosi min+max (malejąco do capa).
Obrażeniowe (base range → cap po pełnym upgrade):
- shield_bash (opener+stun3s): **1.20–1.35× → cap 1.6×** · CD 8s · efekt zostaje
- whirlwind (aoe+taunt): **1.15–1.30× → cap 1.5×** · CD 12s (per-cel niżej bo AoE splash 75%)
- charge (gap+stun2s): **1.35–1.50× → cap 1.8×** · CD 22s
- berserker_rage (+50% atak self 6s + hit): **1.30–1.45× → cap 1.75×** · CD 25s
- execute (kill ≤25% HP): **1.50–1.65× → cap 1.95×** · CD 30s
- ultimate_slash (crit next): **1.50–1.65× → cap 1.95×** · CD 35s
- sword_mastery (DoT — ZBITY do ~10–12% HP/5s): **1.40–1.55× → cap 1.85×** · CD 30s
- titan_cleave (aoe+def_pen40): **1.40–1.55× → cap 1.85×** · CD 40s
- divine_strike (duży aoe): **1.50–1.70× → cap 2.0×** · CD 45s
- god_slash (combo taunt+crit+×5next): **1.60–1.80× → cap 2.15×** · CD 90s
- absolute_cleave (immortal10s): **1.60–1.80× → cap 2.2×** · CD 150s

Buffy (damage:0 — upgrade poprawia buff, nie dmg):
- battle_cry: party +20% atak, upgrade → +czas (5→~10s). CD 15s. „szybki, krótki"
- war_cry: party +30% atak 15s, upgrade → +% atak. CD 40s. „duży, długi" (odróżniony od battle_cry)
- fortify: party +30% def 8s, upgrade → +czas. CD 20s. „szybki"
- iron_defense: party +50% def 10s, upgrade → +% def. CD 22s. „mocny, dłuższy" (odróżniony od fortify)

Globalny cap mnożnika ≈ 2.0× (base), upgrade dopycha najmocniejsze do ~2.2× (asymptota, malejące przyrosty).

### GLOBALNA ZASADA NISZ (opcja A, 2026-07-19) — do egzekwowania przez classMod + attack_speed + crit
Żadna klasa nie jest #1 we wszystkim. Nisze:
- **Mage** — największy pojedynczy cios + AoE (król burstu/czyszczenia fal). Cena: szkło (najniższe HP/DEF).
- **Archer** — najwyższy sustained single-target (crit 100% maxCrit + dystans). Mniejszy burst niż mag.
- **Rogue** — burst na słabych celach (crit + execute/dual-wield). Słaby vs tank/full-HP.
- **Necromancer** — najwyższy ŁĄCZNY dmg (sługi + DoT + %HP). Wolny rozkręt.
- **Knight** — średni dmg, maks przeżywalność.
- **Cleric / Bard** — najniższy własny dmg, wartość w party (heal/buff).
Tempo zabijania (kills/min) ma być zbliżone u DPS-klas mimo różnych mnożników — Mage większe liczby/cios, Archer/Rogue więcej trafień+critów+przeżywalności.

### MAGE — UZGODNIONE (2026-07-19). classMod 1.3 (auto-boost). Mnożniki = docelowy stosunek @ typ. gear.
Obrażeniowe (base → cap):
- fireball L5 (plain, opener/spam): **1.30–1.50× → 1.75×** · CD 5s · L5 ≈ 80–100 ✓
- ice_lance L10: **1.30–1.50× → 1.75×** · CD 6s · **ZMIANA: + slow (−AS celu)** (odróżnić od fireballa)
- thunder_strike L20 (aoe): **1.20–1.40× → 1.6×** · CD 10s
- arcane_bolt L40 (×3 next basic): **1.40–1.60× → 1.85×** · CD 8s
- blizzard L50 (aoe): **1.30–1.50× → 1.75×** · CD 20s
- meteor L60 (aoe+stun3s): **1.50–1.70× → 1.95×** · CD 30s
- arcane_explosion L80 (aoe): **1.50–1.70× → 1.95×** · CD 40s
- apocalypse_spell L100 (aoe+immortal5s): **1.60–1.80× → 2.05×** · CD 60s
- void_ray L150 (lifesteal30%): **1.60–1.80× → 2.05×** · CD 50s
- reality_rend L300 (aoe+def_pen50): **1.60–1.80× → 2.05×** · CD 80s
- singularity L600 (paralyze5s, single-target nuke): **1.80–2.00× → 2.25×** · CD 100s
- god_nova L800 (aoe+lifesteal50): **1.80–2.00× → 2.25×** · CD 150s
- big_bang L1000 (aoe+stun10+immortal10, ultimate): **1.90–2.10× → 2.35×** · CD 200s
Utility: mana_shield L30 (upgrade → dłuższy/+% absorpcji), time_warp L70 (upgrade → +czas/+mult AS).

### CLERIC — UZGODNIONE (2026-07-19). classMod 1.0. Nisza: najniższy własny dmg, król leczenia. Mnożniki celowo niskie.
Obrażeniowe (base → cap):
- holy_strike L5 (+heal 50% dmg): **1.10–1.25× → 1.45×** · CD 6s
- smite L30 (aoe+stun30%): **1.15–1.30× → 1.5×** · CD 15s
- holy_nova L60 (aoe+heal lowest): **1.20–1.35× → 1.55×** · CD 25s
- consecration L70 (aoe): **1.20–1.35× → 1.55×** · CD 35s
- holy_judgment L100 (aoe+def_pen60): **1.25–1.40× → 1.6×** · CD 50s
- divine_wrath L150 (party lifesteal): **1.25–1.40× → 1.6×** · CD 70s
- apocalypse_prayer L600 (aoe+def_pen+heal30): **1.35–1.55× → 1.75×** · CD 120s
- divine_pillar L800 (aoe+party immortal5s): **1.35–1.55× → 1.75×** · CD 150s
- holy_apocalypse L1000 (aoe+immortal+revive): **1.40–1.60× → 1.8×** · CD 240s
Heale/utility: heal (upgrade +%), divine_shield (aktywny blok party — ZOSTAJE, upgrade +ciosy), blessing (+%/czas),
divine_intervention, celestial_heal (+%).
ZMIANY:
- **resurrection_aura + holy_apocalypse revive: wskrzeszają BOTY **ORAZ** żywych graczy z party** (nie tylko boty).
  ⚠ IMPLEMENTACJA: revive gracza wymaga broadcastu przez `partyCombatSyncStore` + akceptacji na kliencie martwego gracza
  (trudniejsze niż bot — osobny item implementacyjny w Etapie 3).
- **resurrection_aura: dodać ~3s nietykalności** po wskrzeszeniu (dziś revive_party:0:0 = brak ochrony).
- **Wyprostować id↔nazwa** u 5 Cleric-skilli (id `holy_judgment`→„Apocalypse Prayer" itd. — pomieszane).

### ARCHER — UZGODNIONE (2026-07-19). classMod 1.2, maxCrit 100%. Nisza: sustained single-target przez crit.
Obrażeniowe (base → cap):
- precise_shot L5 (+30% crit next): **1.30–1.50× → 1.75×** · CD 5s
- poison_arrow L10 (dot ~4%/s): **1.30–1.50× → 1.75×** · CD 8s
- rain_of_arrows L30 (aoe): **1.20–1.40× → 1.6×** · CD 15s
- multishot L50 (3 dod. strzały): **1.40–1.60× → 1.85×** · CD 15s
- wind_arrow L60 (stun3s): **1.50–1.70× → 1.95×** · CD 12s
- sniper_shot L70 (def_pen60): **1.60–1.80× → 2.05×** · CD 35s
- death_arrow L100 (12% HP burst @3%): **1.60–1.80× → 2.05×** · CD 60s
- celestial_arrow L150 (aoe): **1.60–1.80× → 2.05×** · CD 50s
- void_shot L300 (aoe+def_pen60): **1.60–1.80× → 2.05×** · CD 80s
- god_arrow L600 (×2 na 8 next): **1.80–2.00× → 2.25×** · CD 100s
- destiny_shot L800 (12% HP burst @4%): **1.80–2.00× → 2.25×** · CD 150s
- universe_arrow L1000 (aoe+12% HP burst @5%): **1.90–2.10× → 2.35×** · CD 200s
Utility: eagle_eye L20 (+30% crit, upgrade +%/czas), trap L40 (stun CC), **shadow_step L80 CD 20→40s (był OP)**, upgrade skromny.
ZMIANY: DoT wszędzie ~4%/s. **„Instant kill" (death_arrow/destiny_shot/universe_arrow) = mechanika 12% HP burst ZOSTAJE, ale nazwy/opisy uczciwe** (nie „instant kill").

### ROGUE — UZGODNIONE (2026-07-19). classMod 1.0, dual-wield, maxCrit 100%. Nisza: burst na słabych celach, słaby vs full-HP tank.
Obrażeniowe (base → cap):
- backstab L5 (crit next): **1.30–1.50× → 1.75×** · CD 6s
- poison_blade L10 (dot ~4%/s): **1.30–1.50× → 1.75×** · CD 10s
- dual_strike L30 (stun50%): **1.40–1.60× → 1.85×** · CD 8s
- assassinate L50 (kill ≤20% HP): **1.40–1.60× → 1.85×** · CD 30s
- hemorrhage L60 (dot 8s): **1.50–1.70× → 1.95×** · CD 20s
- shadow_clone L70 (×2 next): **1.50–1.70× → 1.95×** · CD 40s
- instant_kill L100 (12% HP burst @3%): **1.60–1.80× → 2.05×** · CD 60s
- shadow_death L150 (aoe): **1.60–1.80× → 2.05×** · CD 70s
- void_strike L300 (def_pen60, anti-tank): **1.60–1.80× → 2.05×** · CD 80s
- death_touch L600 (12% HP burst @5%): **1.80–2.00× → 2.25×** · CD 120s
- god_assassin L800 (aoe+def_pen60): **1.80–2.00× → 2.25×** · CD 160s
- absolute_death L1000 (12% HP burst @8% + unik1): **1.90–2.10× → 2.35×** · CD 200s
Utility ZMIANY: **evasion CD 18→40s** (bliźniak shadow_step), **smoke_bomb CD 25→35s + unik 50→40%**, marked_for_death zostaje (dedup token `mark_no_heal`==`mark_heal_to_dmg`). Nazwy „instant kill" → uczciwe.

### NECROMANCER — UZGODNIONE (2026-07-19). classMod 1.2. Nisza: najwyższy ŁĄCZNY dmg (armia+DoT+%HP), wolny rozkręt.
Bezpośrednie czary (niższe, bo reszta idzie ze sług/DoT) (base → cap):
- life_drain L5 (heal30%): **1.25–1.40× → 1.6×** · CD 6s
- bone_spear L30 (aoe): **1.20–1.40× → 1.6×** · CD 10s
- plague L40 (aoe+dot ~4%/s): **1.30–1.50× → 1.7×** · CD 25s
- soul_harvest L60 (aoe+heal50): **1.40–1.60× → 1.8×** · CD 35s
- death_coil L100 (stun3s): **1.50–1.70× → 1.9×** · CD 50s
- apocalypse_rise L150 (+demon): **1.50–1.70× → 1.9×** · CD 70s
- death_realm L300 (aoe+mark_all×2): **1.60–1.80× → 2.0×** · CD 100s
- soul_storm L600 (aoe+3 ghosty): **1.70–1.90× → 2.1×** · CD 130s
Sługi/DoT/%HP/debuffy: summon_skeleton, raise_dead, army_of_darkness(5 szkiel.), lich_transformation, death_apocalypse(12%HP+sługa).
ZMIANY: **sługi biją ~6–29% zwykłego ciosu Necro + tankują ciosy** (skalują z atakiem; dmgMult 0.10/0.18/0.35/0.50 — REBALANS 2.0.0, patrz niżej); realna armia ≈ +1.24 ciosu/turę → Necro ~1.5× top-DPS (najwyższy łączny). PIERWOTNE „~30–45% + 1.5–2 ciosy" dawało lich > Necro i ~3–5.5× DPS innych klas (rozwalone) — obniżone.
**death_curse mark ×6 → ~×3–4**. **dark_ritual bomba 25% HP → ~12–15% HP**.

### BARD — UZGODNIONE (2026-07-19). classMod 1.0. Nisza: najniższy własny dmg, mnoży DPS party (buffy). Upgrade buffów kluczowy.
Obrażeniowe (5, najniższe) (base → cap):
- dissonance L30 (stun35%): **1.15–1.30× → 1.5×** · CD 18s
- requiem L60 (aoe): **1.20–1.35× → 1.55×** · CD 28s
- epic_saga L80 (+party +40% atak): **1.20–1.35× → 1.55×** · CD 45s
- song_of_doom L300 (aoe+party +20% atak): **1.30–1.45× → 1.65×** · CD 100s
- god_ballad L800 (aoe+party +50% atak): **1.35–1.50× → 1.7×** · CD 180s
Buffy (10) — upgrade → +% siły ALBO +czas (małe przyrosty, cap): battle_hymn, lullaby, ballad_of_heroes, war_song,
heroic_ballad, sirens_call, legends_anthem, divine_melody, cosmic_hymn, universe_song.
ZMIANA: **universe_song `party_instant_kill_chance_next` = MARTWY → zastąpić party dmg-amp (+100% dmg 5s)** (+ zostają immortal/atak/AS).

---

## 6. DESIGN SKILLI KOMPLETNY (7/7 klas, 2026-07-19). Globalne ustalenia:
- **Model:** spell = (BAZA + 0.5·atak)·classMod·rangeRoll → %-DEF → crit(A osobno) → elixiry/transform. Podział 50/50 baza/atak.
- **Mnożniki w tabelach = docelowy stosunek „×zwykły cios" @ typ. gear** (1.15× filler → ~2.1× ultimate; classMod różnicuje klasy).
- **Upgrade:** DMG-skille → malejący przyrost do capa (min i max rosną). Buffy → +% siły/czas (cap). Buffy dostają teraz upgrade (dziś nie).
- **Crit:** opcja A (20%×2.0 osobno).
- **Nisze (opcja A):** Mage burst/AoE (szkło) · Archer sustained single (crit) · Rogue burst na low-HP (execute/dual) · Necro łączny (armia+DoT+%HP, wolny) · Knight tanky-bruiser · Cleric/Bard support (najniższy own dmg).
- **Globalne fixy:** DoT wszędzie ~4%/s · „instant kill" = 12% HP burst z UCZCIWĄ nazwą · nazwy+opisy adekwatne do mechaniki + dokładny dmg z formuły · dead `weaponSkills.damageBonus` → ujednolicić z `getClassSkillBonus` · dead `heal_self_max_pct`/`party_instant_kill` → usunąć/zastąpić · dedup `mark_no_heal`==`mark_heal_to_dmg` · Cleric id↔nazwa wyprostować.
- **Necro sługi:** ~6–29% ciosu Necro + tankują (dmgMult 0.10/0.18/0.35/0.50 po rebalansie 2.0.0 — stare 0.25/0.50/1.20/2.00 dawały lich>Necro i ~3–5.5× DPS innych; realna armia +1.24 ciosu → Necro ~1.5× top-DPS = najwyższy łączny).
- **Cleric revive:** boty ORAZ gracze party (⚠ party-sync) + 3s ochrony.
- **Kluczowe: kalibracja HP contentu (Etap 4/5) liczy effectiveDPS = basic + Σ(skill_dmg/cooldown) całej rotacji**, żeby skille nie kasowały TTK (mob 6–9s, boss 3–4min).

### IMPLEMENTACJA (Etap 3, splata się z Etapem 4/5):
Liczby bezwzględne (BAZA, DMG_SCALE, skala ataku) domykają się z kompresją (Etap 4) — skille i zwykły cios dzielą skalę.
Kroki: (1) nowa formuła skilla w `combatEngine` skill-cast (zastąpić `damage`-coeff modelem baza+atak+range), (2) jedna krzywa
upgrade (asymptota), (3) przepisać `skills.json` (min/max mnożnik + cap zamiast `damage`, nowe cooldowny, zmienione efekty,
nazwy+opisy), (4) generator opisów z formuły, (5) mirror PHP, (6) regen `skillCatalog` test, (7) testy. Necro-sługi + Cleric-revive-gracza = osobne itemy.

- (Mage) — ...
- (Cleric) — ...
- (Archer) — ...
- (Rogue) — ...
- (Necromancer) — ...
- (Bard) — ...
