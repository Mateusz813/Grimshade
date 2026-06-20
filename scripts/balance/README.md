# scripts/balance — balance calibration (source of truth)

Reproducible calibration for the 2026-06-20 kill-rate rebalance. Re-run to
regenerate the data after tweaking targets. Pure offline math (no game state).

- **calibrate.mjs** — HUNT monsters. Model: "with potions you don't die, so kills
  = kill RATE = BUDGET / TTK". Calibrates `src/data/monsters.json` HP/ATK/DEF/speed
  so common+0 at-level lands in the target ranges (normal 5-10, strong 3-8, epic
  2-5, legend 1-3, boss 0-1), L≤10 tuned to the no-gear fresh player.
  Gear scaling: +15% kills/rarity, heroic +105%, +10% kills/upgrade.
  Run: `node scripts/balance/calibrate.mjs`  ( `--apply` writes monsters.json )

- **calibrateContent.mjs** — BOSSES. Calibrates `src/data/bosses.json` so a boss is
  solo-clearable (with potions) at the gear threshold: DPS classes ≈ legendary+3,
  support ≈ mythic+3; rare+3 slow; BiS fast; no one-shot; monotonic.
  Run: `node scripts/balance/calibrateContent.mjs`  ( `--apply` writes bosses.json )

Gear constants live in `src/data/itemTemplates.json` (rarityMultipliers) and
`src/systems/itemSystem.ts` (getEnhancementMultiplier). Transform curve lives in
`src/systems/transformSystem.ts` (scaleMonsterStats + TRANSFORM_BOSS_MULTIPLIER).
Dungeons/raids scale off monsters.json so they inherit the hunt calibration.
