// Barrel exports for the unified combat UI.
//
// All combat views (Combat=hunting, Boss, Dungeon, Transform, Raid, Trainer)
// pull from this entry. Each view supplies its own data — the components
// own the layout, animations, and polish so the experience is identical
// across modes (just with more or fewer features visible).
//
// Required wiring per view:
//   1. `<CombatHudHost active={isFighting}>` somewhere near the root —
//      tells AppShell to swap the global BottomNav for the combat action bar.
//   2. `<CombatTopControls .../>` under the header (only during fight).
//   3. `<CombatTaskBadge items={...}/>` top-left (only during fight, hunting/boss/etc.).
//   4. `<CombatArena enemies={...} allies={...} />` for the 4v4 grid.
//   5. `<CombatSubControls .../>` for flat potions + XP bar + backpack + logs.
//   6. (Hunting only) `<HuntedTally />` strip + (only when victory) the
//       new bottom action footer with "Walcz ponownie" / "Zmień potwora".
//   7. `<CombatActionBar .../>` fixed at the bottom — replaces nav.
//   8. (Hunting only) `<HuntExitDialog />` triggered from the action bar.
//
// Import its SCSS once (in the view's own SCSS) via `@use` of CombatUI.scss.

export { CombatHudHost } from './CombatHudHost';
export { default as CombatArena } from './CombatArena';
export { default as EnemyCard } from './EnemyCard';
export { default as AllyCard } from './AllyCard';
export { default as CombatTopControls } from './CombatTopControls';
export { default as CombatTaskBadge } from './CombatTaskBadge';
export { default as CombatSubControls } from './CombatSubControls';
export { default as CombatActionBar } from './CombatActionBar';
export { default as CombatPotionDock } from './CombatPotionDock';
export { default as CombatBackpackModal } from './CombatBackpackModal';
export { default as CombatLogsModal } from './CombatLogsModal';
export { default as HuntedTally } from './HuntedTally';
export { default as HuntExitDialog } from './HuntExitDialog';

export type {
    ICombatEnemy,
    ICombatAlly,
    ICombatSkillSlot,
    ICombatPotionSlot,
    ICombatActiveQuest,
    TExitConfig,
    ICombatFloat,
    ICombatSkillAnim,
} from './types';
