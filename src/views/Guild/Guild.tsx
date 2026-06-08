import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useTransformStore } from '../../stores/transformStore';
import { useGuildStore } from '../../stores/guildStore';
import {
    guildApi,
    type IGuildRow,
    type IGuildMemberRow,
    type IGuildJoinRequestRow,
    type IGuildBossStateRow,
    type IGuildBossContributionRow,
    type IGuildBossAttemptRow,
    type IGuildTreasuryItemRow,
    type IGuildTreasuryLogRow,
} from '../../api/v1/guildApi';
import {
    GUILD_ICONS,
    GUILD_COLORS,
    getGuildIcon,
} from '../../data/guildIcons';
import {
    GUILD_CREATE_COST_GOLD,
    GUILD_BOSS_HEROIC_MAX_CHANCE,
    GUILD_TREASURY_SLOTS,
    GUILD_BOSS_MAX_TIER,
    applyGuildXp,
    clampGuildBossTier,
    computeGuildBossDamage,
    contributionMultiplier,
    getCurrentWeekStartIso,
    guildMemberCap,
    guildXpToNextLevel,
    isGuildBossClaimDay,
} from '../../systems/guildSystem';
import { getLochBackground, getLochBossImage } from '../../data/guildLochAssets';
import {
    pickGuildBossSpell,
    computeBossSpellDamage,
    getBossCastIntervalMs,
    getGuildBossLabel,
    type IGuildBossSpell,
} from '../../data/guildBossSpells';
import { getCharacterAvatar } from '../../data/classAvatars';
import { getTransformColor } from '../../systems/transformSystem';
import { getEffectiveChar } from '../../systems/combatEngine';
import Chat from '../../components/ui/Chat/Chat';
import { useSkillStore } from '../../stores/skillStore';
import { getSkillIcon } from '../../data/skillIcons';
import skillsData from '../../data/skills.json';
import { useCombatFx } from '../../hooks/useCombatFx';
import CombatArena from '../../components/organisms/CombatUI/CombatArena';
import type { ICombatEnemy, ICombatAlly } from '../../components/organisms/CombatUI/types';

interface IGuildPlayerSkill {
    id: string;
    mpCost: number;
    cooldown: number;
    damage: number;
    unlockLevel: number;
}

/** Pull the player's slotted active skills, filtered by their current
 *  level. Mirrors the helper from Raid/Boss views — guild boss combat
 *  reuses the same per-class skill table so the player's slots line up
 *  with everything else they fight. */
const getGuildPlayerSkills = (cls: string): IGuildPlayerSkill[] => {
    const key = cls.toLowerCase() as keyof typeof skillsData.activeSkills;
    const list = (skillsData.activeSkills[key] ?? []) as Array<{
        id: string;
        mpCost: number;
        cooldown: number;
        damage: number;
        unlockLevel: number;
    }>;
    return list.map((s) => ({
        id: s.id,
        mpCost: s.mpCost ?? 0,
        cooldown: s.cooldown ?? 5000,
        damage: s.damage ?? 1,
        unlockLevel: s.unlockLevel ?? 1,
    }));
};
import { getItemDisplayInfo } from '../../systems/itemGenerator';
import ItemIcon from '../../components/ui/ItemIcon/ItemIcon';
import type { IInventoryItem, TRarity, TEquipmentSlot } from '../../types/item';
import { formatGoldShort } from '../../systems/goldFormat';
import imgLoch     from '../../assets/images/guild/guild-loch.png';
import imgSkarbiec from '../../assets/images/guild/guild-skarbiec.png';
import imgProsby   from '../../assets/images/guild/guild-prosby.png';
import {
    getItemSlotSafe,
    flattenItemsData,
    RARITY_COLORS as CANONICAL_RARITY_COLORS,
    RARITY_LABELS as CANONICAL_RARITY_LABELS,
} from '../../systems/itemSystem';
import { getItemFile } from '../../systems/spriteAssets';
import itemsRaw from '../../data/items.json';
import './Guild.scss';

const ALL_ITEMS_FLAT = flattenItemsData(itemsRaw);

// 2026-05-18 spec ("Kolory filtrow bledne, kolor ma odpowiadac rarity
// czyli legendary czerwony heroic fiolet"): use the SHARED palette
// from itemSystem instead of a local divergent copy. Legendary=red,
// heroic=purple, epic=green, mythic=yellow — matches every other
// rarity display in the app (inventory grid, market, drops popups).
const RARITY_COLORS: Record<TRarity, string> = CANONICAL_RARITY_COLORS;
const RARITY_LABELS: Record<TRarity, string> = CANONICAL_RARITY_LABELS;

type TRarityFilter = 'all' | TRarity;
const RARITY_FILTERS: TRarityFilter[] = ['all', 'common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];

// 2026-05-18 spec ("brakuje filtra ikonkami jak w plecaku pancerz,
// bron 1 bron 2, spodnie buty itp."): mirror the inventory's full
// per-slot filter set. Pills render the item's PNG icon when
// available, with an emoji fallback when the asset hasn't been
// bundled yet (same fallback strategy as Inventory.tsx).
type TSlotFilter =
    | 'all'
    | 'weapons' | 'jewelry'
    | 'mainHand' | 'offHand' | 'helmet' | 'shoulders'
    | 'armor' | 'gloves' | 'pants' | 'boots'
    | 'necklace' | 'earrings' | 'ring1';

interface ISlotFilterDef { id: TSlotFilter; label: string; icon: string; }

const ICON_HELMET   = getItemFile('helmet-lekki') ?? '⛑️';
const ICON_ARMOR    = getItemFile('armor-lekki') ?? '🦺';
const ICON_PANTS    = getItemFile('legs-lekki') ?? '👖';
const ICON_BOOTS    = getItemFile('boots-lekki') ?? '👢';
const ICON_GLOVES   = getItemFile('glove-lekki') ?? '🧤';
const ICON_SHOULDER = getItemFile('shoulder-lekki') ?? '🎖️';
const ICON_SWORD    = getItemFile('miecz') ?? '⚔️';
const ICON_SHIELD   = getItemFile('tarcza') ?? '🛡️';
const ICON_RING     = getItemFile('ring') ?? '💍';
const ICON_NECK     = getItemFile('nackle') ?? '📿';
const ICON_EARRINGS = getItemFile('earrings') ?? '✨';

const SLOT_FILTERS: ISlotFilterDef[] = [
    { id: 'all',        label: 'Wszystkie',    icon: '🎒' },
    { id: 'weapons',    label: 'Bronie',       icon: ICON_SWORD },
    { id: 'jewelry',    label: 'Biżuteria',    icon: ICON_NECK },
    { id: 'mainHand',   label: 'Główna',       icon: ICON_SWORD },
    { id: 'offHand',    label: 'Pomocnicza',   icon: ICON_SHIELD },
    { id: 'helmet',     label: 'Hełm',         icon: ICON_HELMET },
    { id: 'shoulders',  label: 'Naramienniki', icon: ICON_SHOULDER },
    { id: 'armor',      label: 'Zbroja',       icon: ICON_ARMOR },
    { id: 'gloves',     label: 'Rękawice',     icon: ICON_GLOVES },
    { id: 'pants',      label: 'Spodnie',      icon: ICON_PANTS },
    { id: 'boots',      label: 'Buty',         icon: ICON_BOOTS },
    { id: 'necklace',   label: 'Naszyjnik',    icon: ICON_NECK },
    { id: 'earrings',   label: 'Kolczyki',     icon: ICON_EARRINGS },
    { id: 'ring1',      label: 'Pierścienie',  icon: ICON_RING },
];

/** Mirror the inventory's slot-filter logic — same buckets so a player
 *  who knows the bag filters can find their items the same way in the
 *  guild treasury. */
const itemMatchesSlotFilter = (itemId: string, filter: TSlotFilter): boolean => {
    if (filter === 'all') return true;
    const slot = getItemSlotSafe(itemId, ALL_ITEMS_FLAT) as TEquipmentSlot | null;
    if (!slot) return false;
    if (filter === 'weapons') return slot === 'mainHand' || slot === 'offHand';
    if (filter === 'jewelry') {
        return slot === 'ring1' || slot === 'ring2' || slot === 'necklace' || slot === 'earrings';
    }
    // ring1 pill covers BOTH ring slots so a player who only knows about
    // "rings" doesn't have to think about ring1 vs ring2 separately.
    if (filter === 'ring1') return slot === 'ring1' || slot === 'ring2';
    return slot === filter;
};

// 2026-05-18 spec ("oraz sortowanie od lvl w gore lub w dol"): per-
// column sort order — inventory uses level desc by default, we mirror
// that and let the player toggle to ascending.
type TSortOrder = 'level-desc' | 'level-asc';
const SORT_LABELS: Record<TSortOrder, string> = {
    'level-desc': 'Lvl ↓',
    'level-asc':  'Lvl ↑',
};

const PAGE_SIZE = 10;

const CLASS_ICONS: Record<string, string> = {
    Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
    Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

type ScreenKey =
    | 'list'
    | 'home'
    | 'boss'
    | 'treasury'
    | 'requests';

/**
 * Guild view — single entry point at `/guild`. Routes between an
 * unaffiliated player's guild browser and a member's guild home + sub
 * screens (boss, treasury, requests) via internal state instead of
 * extra react-router entries.
 *
 * Sub-screens collapse back to the entry view with the leading nav
 * button so the URL bar stays at `/guild` throughout. Players hitting
 * F5 always land on the right screen because membership is hydrated
 * from `useGuildStore` on mount.
 */
const Guild = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const guildState = useGuildStore();
    const [screen, setScreen] = useState<ScreenKey>('list');
    const lastCharacterRef = useRef<string | null>(null);

    // Hydrate the player's guild row whenever the active character
    // changes. The store keys per-character so switching characters
    // mid-session updates membership without a page refresh.
    useEffect(() => {
        if (!character?.id) return;
        if (lastCharacterRef.current === character.id) return;
        lastCharacterRef.current = character.id;
        void guildState.hydrateForCharacter(character.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character?.id]);

    // Whenever we have a guild → default screen is home; if we
    // dropped the guild while inside a sub-screen, snap back to list.
    useEffect(() => {
        if (guildState.guild) {
            if (screen === 'list') setScreen('home');
        } else {
            if (screen !== 'list') setScreen('list');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [guildState.guild?.id]);

    if (!character) {
        return (
            <div className="guild">
                <header className="guild__top-bar">
                    <h1 className="guild__top-title">🏛️ Gildie</h1>
                </header>
                <div className="guild__empty">Zaloguj się, by przeglądać gildie.</div>
            </div>
        );
    }

    return (
        <div className="guild">
            {screen === 'list' && (
                <GuildList
                    onPickGuildToApply={() => { /* handled inline */ }}
                    onEnterMine={() => setScreen('home')}
                />
            )}
            {screen === 'home' && guildState.guild && (
                <GuildHome
                    onBack={() => navigate('/')}
                    onOpenBoss={() => setScreen('boss')}
                    onOpenTreasury={() => setScreen('treasury')}
                    onOpenRequests={() => setScreen('requests')}
                />
            )}
            {screen === 'boss' && guildState.guild && (
                <GuildBoss onBack={() => setScreen('home')} />
            )}
            {screen === 'treasury' && guildState.guild && (
                <GuildTreasury onBack={() => setScreen('home')} />
            )}
            {screen === 'requests' && guildState.guild && (
                <GuildRequests onBack={() => setScreen('home')} />
            )}
        </div>
    );
};

// ═════════════════════════════════════════════════════════════════════════════
// GUILD LIST — paginated browser + create button.
// Spec items 1–5: header, search, paginated rows (logo · name · 🤝),
// "Stwórz gildię" button at the bottom.
// ═════════════════════════════════════════════════════════════════════════════

interface IGuildListProps {
    onPickGuildToApply: (g: IGuildRow) => void;
    onEnterMine: () => void;
}

const GuildList = ({ onEnterMine }: IGuildListProps) => {
    const character = useCharacterStore((s) => s.character);
    const guildState = useGuildStore();
    const [page, setPage] = useState(0);
    const [search, setSearch] = useState('');
    const [rows, setRows] = useState<IGuildRow[]>([]);
    const [summaries, setSummaries] = useState<Record<string, { memberCount: number; leaderName: string | null }>>({});
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [applyTarget, setApplyTarget] = useState<IGuildRow | null>(null);
    const [applyBusy, setApplyBusy] = useState(false);
    const [applyMsg, setApplyMsg] = useState<string | null>(null);

    const fetchPage = useCallback(async () => {
        setLoading(true);
        try {
            const [list, count] = await Promise.all([
                guildApi.listGuilds({ offset: page * PAGE_SIZE, limit: PAGE_SIZE, search }),
                guildApi.countGuilds(search),
            ]);
            setRows(list);
            setTotal(count);
            // Side-load member count + leader name for the visible page
            // so each row shows "1/20 · Lider Krasek".
            if (list.length > 0) {
                const summary = await guildApi.listGuildSummaries(list.map((g) => g.id));
                setSummaries(summary);
            } else {
                setSummaries({});
            }
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => { void fetchPage(); }, [fetchPage]);

    // Refresh when the player creates a guild so the new row pops up
    // top of list before they navigate into it.
    useEffect(() => {
        if (guildState.guild) onEnterMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [guildState.guild?.id]);

    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const handleApplyConfirm = async () => {
        if (!applyTarget || !character) return;
        setApplyBusy(true);
        try {
            await guildApi.requestJoin({
                guildId: applyTarget.id,
                characterId: character.id,
                characterName: character.name,
                characterClass: character.class,
                characterLevel: character.level,
                characterTransformTier: useTransformStore.getState().getHighestCompletedTransform?.() ?? 0,
            });
            setApplyMsg(`Wysłano prośbę o dołączenie do ${applyTarget.name}.`);
            setApplyTarget(null);
        } catch (err) {
            setApplyMsg(err instanceof Error ? err.message : 'Nie udało się wysłać prośby.');
        } finally {
            setApplyBusy(false);
        }
    };

    return (
        <>
            <header className="guild__top-bar">
                <h1 className="guild__top-title">🏛️ Gildie</h1>
            </header>

            <div className="guild__list-box">
                <div className="guild__list-search">
                    <input
                        type="text"
                        placeholder="Szukaj gildii po nazwie…"
                        value={search}
                        onChange={(e) => { setPage(0); setSearch(e.target.value); }}
                    />
                </div>
                {loading ? (
                    <div className="guild__list-empty">Ładowanie…</div>
                ) : rows.length === 0 ? (
                    <div className="guild__list-empty">Brak gildii spełniających kryteria.</div>
                ) : (
                    <ul className="guild__list">
                        {rows.map((g) => {
                            const summary = summaries[g.id];
                            const memberCount = summary?.memberCount ?? 0;
                            const leaderName = summary?.leaderName ?? '—';
                            return (
                                <li key={g.id} className="guild__list-row">
                                    <span
                                        className="guild__list-logo"
                                        style={{ background: g.color }}
                                        title={g.name}
                                    >
                                        {getGuildIcon(g.logo)}
                                    </span>
                                    <div className="guild__list-info">
                                        <div className="guild__list-name">
                                            <span className="guild__list-tag">[{g.tag}]</span>
                                            {' '}{g.name}
                                        </div>
                                        <div className="guild__list-meta">
                                            Lvl {g.level} · {memberCount}/{g.member_cap}
                                        </div>
                                        <div className="guild__list-meta">
                                            Lider <strong>{leaderName}</strong>
                                        </div>
                                    </div>
                                    <button
                                        className="guild__list-apply"
                                        onClick={() => setApplyTarget(g)}
                                        title="Aplikuj do gildii"
                                    >
                                        🤝
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {pageCount > 1 && (
                    <div className="guild__list-pager">
                        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>← Poprzednia</button>
                        <span>Strona {page + 1} / {pageCount}</span>
                        <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>Następna →</button>
                    </div>
                )}
                <div className="guild__list-actions">
                    <button
                        className="guild__list-create"
                        onClick={() => setCreateOpen(true)}
                    >
                        ➕ Stwórz gildię
                    </button>
                </div>
                {applyMsg && (
                    <div className="guild__toast">{applyMsg}</div>
                )}
            </div>

            {applyTarget && (
                <Modal onClose={() => setApplyTarget(null)} title="Aplikuj do gildii">
                    <p>Czy chcesz aplikować do gildii <strong>[{applyTarget.tag}] {applyTarget.name}</strong>?</p>
                    <div className="guild__modal-actions">
                        <button onClick={() => setApplyTarget(null)} disabled={applyBusy}>Anuluj</button>
                        <button className="guild__btn-primary" onClick={handleApplyConfirm} disabled={applyBusy}>
                            {applyBusy ? 'Wysyłanie…' : 'Aplikuj'}
                        </button>
                    </div>
                </Modal>
            )}

            {createOpen && (
                <GuildCreateDialog
                    onClose={() => setCreateOpen(false)}
                    onCreated={() => {
                        setCreateOpen(false);
                        if (character) void useGuildStore.getState().hydrateForCharacter(character.id);
                    }}
                />
            )}
        </>
    );
};

// ═════════════════════════════════════════════════════════════════════════════
// CREATE DIALOG — pick logo + color + name + tag, pay 10cc gold.
// Spec items 4–5.
// ═════════════════════════════════════════════════════════════════════════════

interface IGuildCreateDialogProps {
    onClose: () => void;
    onCreated: () => void;
}

const GuildCreateDialog = ({ onClose, onCreated }: IGuildCreateDialogProps) => {
    const character = useCharacterStore((s) => s.character);
    const gold = useInventoryStore((s) => s.gold);
    const spendGold = useInventoryStore((s) => s.spendGold);

    const [logo, setLogo] = useState<string>(GUILD_ICONS[0].id);
    const [color, setColor] = useState<string>(GUILD_COLORS[0]);
    const [name, setName] = useState('');
    const [tag, setTag] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const canAfford = gold >= GUILD_CREATE_COST_GOLD;

    const handleCreate = async () => {
        if (!character) return;
        const trimmedName = name.trim();
        const trimmedTag = tag.trim().toUpperCase();
        setError(null);
        if (trimmedName.length < 3) { setError('Nazwa gildii musi mieć min. 3 znaki.'); return; }
        if (trimmedName.length > 24) { setError('Nazwa gildii max. 24 znaki.'); return; }
        if (trimmedTag.length < 2 || trimmedTag.length > 3) { setError('Tag gildii musi mieć 2–3 litery.'); return; }
        if (!/^[A-Z0-9]+$/.test(trimmedTag)) { setError('Tag może zawierać tylko litery A–Z i cyfry.'); return; }
        if (!canAfford) { setError(`Brak gotówki — koszt to ${formatGoldShort(GUILD_CREATE_COST_GOLD)}.`); return; }

        setBusy(true);
        try {
            const ok = spendGold(GUILD_CREATE_COST_GOLD);
            if (!ok) {
                setError('Brak gotówki — koszt to 10cc.');
                setBusy(false);
                return;
            }
            const guild = await guildApi.createGuild({
                name: trimmedName,
                tag: trimmedTag,
                logo,
                color,
                leaderId: character.id,
                leaderName: character.name,
                leaderClass: character.class,
                leaderLevel: character.level,
                leaderTransformTier: useTransformStore.getState().getHighestCompletedTransform?.() ?? 0,
            });
            useGuildStore.getState().setGuild(guild);
            // Drop the founder from every other guild's pending requests.
            await guildApi.purgeRequestsForCharacter(character.id).catch(() => { /* offline */ });
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Tworzenie gildii nie powiodło się.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal onClose={onClose} title="Stwórz gildię" wide>
            <p className="guild__create-cost">
                Koszt: <strong>{formatGoldShort(GUILD_CREATE_COST_GOLD)}</strong> golda.
                {' '}Masz: <strong>{formatGoldShort(gold)}</strong>.
            </p>
            <label className="guild__create-label">Logo</label>
            <div className="guild__create-icons">
                {GUILD_ICONS.map((g) => (
                    <button
                        key={g.id}
                        className={`guild__create-icon-tile${logo === g.id ? ' is-selected' : ''}`}
                        onClick={() => setLogo(g.id)}
                        title={g.label}
                    >
                        {g.icon}
                    </button>
                ))}
            </div>
            <label className="guild__create-label">Kolor tła</label>
            <div className="guild__create-colors">
                {GUILD_COLORS.map((c) => (
                    <button
                        key={c}
                        className={`guild__create-color-tile${color === c ? ' is-selected' : ''}`}
                        style={{ background: c }}
                        onClick={() => setColor(c)}
                        aria-label={`Kolor ${c}`}
                    />
                ))}
            </div>
            <label className="guild__create-label">Podgląd</label>
            <div className="guild__create-preview">
                <span
                    className="guild__list-logo guild__list-logo--big"
                    style={{ background: color }}
                >
                    {getGuildIcon(logo)}
                </span>
                <div>
                    <div className="guild__list-name">
                        <span className="guild__list-tag">[{tag.toUpperCase() || 'XXX'}]</span>
                        {' '}{name || 'Nazwa gildii'}
                    </div>
                    <div className="guild__list-meta">Lvl 1 · {character?.name}</div>
                </div>
            </div>
            <label className="guild__create-label" htmlFor="guild-name">Nazwa gildii</label>
            <input
                id="guild-name"
                className="guild__create-input"
                type="text"
                value={name}
                maxLength={24}
                placeholder="np. Smocze Pazury"
                onChange={(e) => setName(e.target.value)}
            />
            <label className="guild__create-label" htmlFor="guild-tag">Tag (2–3 znaki)</label>
            <input
                id="guild-tag"
                className="guild__create-input"
                type="text"
                value={tag}
                maxLength={3}
                placeholder="np. SMK"
                onChange={(e) => setTag(e.target.value.toUpperCase())}
            />
            {error && <div className="guild__create-error">{error}</div>}
            <div className="guild__modal-actions">
                <button onClick={onClose} disabled={busy}>Anuluj</button>
                <button className="guild__btn-primary" onClick={handleCreate} disabled={busy || !canAfford}>
                    {busy ? 'Tworzenie…' : 'Stwórz gildię'}
                </button>
            </div>
        </Modal>
    );
};

// ═════════════════════════════════════════════════════════════════════════════
// GUILD HOME — logo, name, level + xp, members list, nav to sub-screens.
// Spec items 7–11, 13–17.
// ═════════════════════════════════════════════════════════════════════════════

interface IGuildHomeProps {
    onBack: () => void;
    onOpenBoss: () => void;
    onOpenTreasury: () => void;
    onOpenRequests: () => void;
}

const GuildHome = ({ onBack, onOpenBoss, onOpenTreasury, onOpenRequests }: IGuildHomeProps) => {
    const character = useCharacterStore((s) => s.character);
    const guild = useGuildStore((s) => s.guild)!;
    const members = useGuildStore((s) => s.members);
    const requestsCount = useGuildStore((s) => s.requests.length);
    const isLeader = guild.leader_id === character?.id;
    const [confirmKick, setConfirmKick] = useState<IGuildMemberRow | null>(null);
    const [confirmLeave, setConfirmLeave] = useState(false);

    // 2026-05-18 spec ("Przed ikonkami akcji kazdej postaci napisz ile
    // XP dla gildii dodali poprzez atak bossa"): pull this week's
    // boss contribution map so every member row shows their personal
    // damage-dealt next to the kick/leave buttons. Refresh on a 5 s
    // poll so the live counter ticks up while the boss is being
    // pummeled.
    const [contribMap, setContribMap] = useState<Record<string, number>>({});
    useEffect(() => {
        if (!guild) return;
        const refresh = async () => {
            try {
                const rows = await guildApi.listContributions({
                    guildId: guild.id,
                    weekStart: getCurrentWeekStartIso(),
                });
                const out: Record<string, number> = {};
                for (const r of rows) out[r.character_id] = r.total_damage;
                setContribMap(out);
            } catch { /* offline */ }
        };
        void refresh();
        const t = setInterval(refresh, 5000);
        return () => clearInterval(t);
    }, [guild]);

    // Push our latest character snapshot to the guild row so the
    // member list reflects level/class changes (e.g. after death
    // penalty or class transform). Includes the highest-completed
    // transform tier so other guild mates immediately see the new
    // avatar art on the roster.
    useEffect(() => {
        if (!character || !guild) return;
        const me = members.find((m) => m.character_id === character.id);
        if (!me) return;
        const myTier = useTransformStore.getState().getHighestCompletedTransform?.() ?? 0;
        const stale =
            me.character_level !== character.level
            || me.character_class !== character.class
            || (me.character_transform_tier ?? 0) !== myTier;
        if (stale) {
            void guildApi.updateMemberStats({
                characterId: character.id,
                level: character.level,
                characterClass: character.class,
                transformTier: myTier,
            }).catch(() => { /* offline */ });
        }
    }, [character, guild, members]);

    const handleKickConfirm = async () => {
        if (!confirmKick) return;
        await guildApi.kickMember({ guildId: guild.id, characterId: confirmKick.character_id });
        setConfirmKick(null);
    };

    const handleLeaveConfirm = async () => {
        if (!character) return;
        const { disbanded } = await guildApi.leaveGuild({ guildId: guild.id, characterId: character.id });
        void disbanded; // disbanded flag isn't surfaced — store hydrate handles teardown.
        useGuildStore.getState().clear();
        await useGuildStore.getState().hydrateForCharacter(character.id);
        setConfirmLeave(false);
    };

    const xpToNext = guildXpToNextLevel(guild.level);
    const xpPct = xpToNext > 0 && xpToNext !== Infinity
        ? Math.min(1, guild.xp / xpToNext)
        : 1;

    // 2026-05-18 spec ("Kasujemy caly ten header wroc"): no top bar
    // on guild home — the bottom nav (Społeczność) already gates the
    // section, so the duplicate "← Miasto" button just stole vertical
    // space. Banner sits flush with the top of the screen instead.
    void onBack;

    return (
        <>
            <div className="guild__home-banner">
                <span
                    className="guild__list-logo guild__list-logo--big"
                    style={{ background: guild.color }}
                >
                    {getGuildIcon(guild.logo)}
                </span>
                <div className="guild__home-titles">
                    <div className="guild__home-name">
                        <span className="guild__list-tag">[{guild.tag}]</span> {guild.name}
                    </div>
                    <div className="guild__home-level">
                        Poziom <strong>{guild.level}</strong>
                        {' · '}
                        Członkowie {members.length}/{guild.member_cap}
                    </div>
                    {/* 2026-05-18 spec ("Poziom gildi na srodku napisz
                        ile % poziomu jest wbite oraz ile XP / ile do
                        kolejnego poziomu"): xp bar gets a centred
                        readout — "37 % · 372 / 1 000 XP" — so the
                        player sees both the percentage and the raw
                        ratio at a glance. */}
                    <div
                        className="guild__home-xpbar"
                        title={`${guild.xp.toLocaleString('pl-PL')} / ${xpToNext === Infinity ? '∞' : xpToNext.toLocaleString('pl-PL')} XP`}
                    >
                        <span className="guild__home-xpbar-fill" style={{ width: `${xpPct * 100}%` }} />
                        <span className="guild__home-xpbar-text">
                            {Math.floor(xpPct * 100)}% · {guild.xp.toLocaleString('pl-PL')} / {xpToNext === Infinity ? '∞' : xpToNext.toLocaleString('pl-PL')} XP
                        </span>
                    </div>
                </div>
            </div>

            {/* 2026-05-18 spec ("Kafelki Loch skarbiec prosby nad lista
                czlonkow gildii"): nav row moved ABOVE the member list so
                the player's primary actions are the first thing they
                see; member roster scrolls below.
                2026-05-18 v2 ("Zamiast ikonek do nawigacji ... uzyj
                zdjec w pliku guild/ tak samo jak te kafelki sa w
                miescie, napis na dole i zdjecie jako tlo"): each tile
                is a full-bleed <img> with a frosted-glass label glued
                to the bottom — mirrors the town tile layout exactly. */}
            <nav className="guild__nav">
                <button className="guild__nav-tile" onClick={onOpenBoss}>
                    <img className="guild__nav-tile-img" src={imgLoch} alt="" draggable={false} />
                    <span className="guild__nav-tile-label">Loch</span>
                </button>
                <button className="guild__nav-tile" onClick={onOpenTreasury}>
                    <img className="guild__nav-tile-img" src={imgSkarbiec} alt="" draggable={false} />
                    <span className="guild__nav-tile-label">Skarbiec</span>
                </button>
                <button className="guild__nav-tile" onClick={onOpenRequests}>
                    <img className="guild__nav-tile-img" src={imgProsby} alt="" draggable={false} />
                    <span className="guild__nav-tile-label">
                        Prośby{requestsCount > 0 ? ` (${requestsCount})` : ''}
                    </span>
                </button>
            </nav>

            <ul className="guild__members">
                {members.map((m) => (
                    <MemberRow
                        key={m.id}
                        member={m}
                        isLeader={guild.leader_id === m.character_id}
                        isMe={m.character_id === character?.id}
                        showKick={isLeader && m.character_id !== character?.id}
                        bossContribution={contribMap[m.character_id] ?? 0}
                        onKick={() => setConfirmKick(m)}
                        onLeave={() => setConfirmLeave(true)}
                    />
                ))}
            </ul>

            {/* 2026-05-18 spec ("Pod lista graczy dodaj jeszcze chat
                gildyjny i trzymaj ostatnie 500 wiadomosci"): per-guild
                chat channel `guild_{guildId}` mounted right under the
                member roster. Reuses the shared Chat component with a
                `messageCap={500}` override so historic messages survive
                past the default 100-cap PM trim. */}
            {character && (
                <div className="guild__chat">
                    <Chat
                        channel={`guild_${guild.id}`}
                        characterName={character.name}
                        characterClass={character.class}
                        characterLevel={character.level}
                        title="💬 Chat gildii"
                        maxHeight={320}
                        messageCap={500}
                    />
                </div>
            )}

            {confirmKick && (
                <Modal onClose={() => setConfirmKick(null)} title="Wyrzuć gracza">
                    <p>Czy na pewno chcesz wyrzucić <strong>{confirmKick.character_name}</strong> z gildii?</p>
                    <div className="guild__modal-actions">
                        <button onClick={() => setConfirmKick(null)}>Anuluj</button>
                        <button className="guild__btn-danger" onClick={handleKickConfirm}>Wyrzuć</button>
                    </div>
                </Modal>
            )}
            {confirmLeave && (
                <Modal onClose={() => setConfirmLeave(false)} title="Opuść gildię">
                    <p>Czy na pewno chcesz opuścić gildię <strong>{guild.name}</strong>?</p>
                    {isLeader && members.length > 1 && (
                        <p className="guild__home-warning">
                            Jesteś liderem. Po opuszczeniu lider zostanie przekazany
                            kolejnemu członkowi.
                        </p>
                    )}
                    {isLeader && members.length <= 1 && (
                        <p className="guild__home-warning">
                            Jesteś ostatnim członkiem — gildia zostanie rozwiązana.
                        </p>
                    )}
                    <div className="guild__modal-actions">
                        <button onClick={() => setConfirmLeave(false)}>Anuluj</button>
                        <button className="guild__btn-danger" onClick={handleLeaveConfirm}>Opuść</button>
                    </div>
                </Modal>
            )}
        </>
    );
};

interface IMemberRowProps {
    member: IGuildMemberRow;
    isLeader: boolean;
    isMe: boolean;
    showKick: boolean;
    bossContribution: number;
    onKick: () => void;
    onLeave: () => void;
}

const MemberRow = ({ member, isLeader, isMe, showKick, bossContribution, onKick, onLeave }: IMemberRowProps) => {
    // 2026-05-18 spec ("avatary powinny byc aktualnych transformow
    // tych postaci"): every member ships their `character_transform_tier`
    // in the row, so we feed that single tier into getCharacterAvatar
    // (the helper iterates 1..tier and picks the highest tier avatar
    // PNG present in classAvatars). For me we still prefer the live
    // store value so a transform completed THIS SESSION renders before
    // the next server-side sync lands.
    const character = useCharacterStore((s) => s.character);
    let avatarUrl: string | null = null;
    let transformCss: string | null = null;
    if (isMe && character) {
        const completed = useTransformStore.getState().completedTransforms ?? [];
        avatarUrl = getCharacterAvatar(member.character_class, completed);
        const tColor = useTransformStore.getState().getHighestTransformColor();
        transformCss = tColor?.css ?? null;
    } else {
        // Reconstruct an "all tiers up to my level completed" array
        // from the stored highest tier — getCharacterAvatar picks the
        // top match, so we don't need the exact per-tier history.
        const tier = member.character_transform_tier ?? 0;
        const completed = tier > 0
            ? Array.from({ length: tier }, (_, i) => i + 1)
            : [];
        avatarUrl = getCharacterAvatar(member.character_class, completed);
        if (tier > 0) {
            transformCss = getTransformColor(tier).css;
        }
    }
    const borderColor = transformCss ?? CLASS_COLORS[member.character_class] ?? '#888';

    return (
        <li className={`guild__member-row${isMe ? ' is-me' : ''}`}>
            <span
                className={`guild__member-avatar${transformCss ? ' is-shimmer' : ''}`}
                style={{ border: `2px solid ${borderColor}` }}
            >
                {avatarUrl ? (
                    <img src={avatarUrl} alt={member.character_name} />
                ) : (
                    <span className="guild__member-avatar-fallback">
                        {CLASS_ICONS[member.character_class] ?? '?'}
                    </span>
                )}
            </span>
            <span className="guild__member-class-icon">
                {CLASS_ICONS[member.character_class] ?? '?'}
            </span>
            <div className="guild__member-info">
                <div className="guild__member-name">
                    {isLeader && <span className="guild__member-crown" title="Lider gildii">👑</span>}
                    {member.character_name}
                    {isMe && <span className="guild__member-self">Ty</span>}
                </div>
                <div className="guild__member-class" style={{ color: CLASS_COLORS[member.character_class] }}>
                    {member.character_class} · Lvl {member.character_level}
                </div>
            </div>
            {/* 2026-05-18 v2 spec ("Na mobilce ile XP pod nickiem i
                avatarem a akcje ponizej XP"): XP chip + action buttons
                share a single `__member-actions` cell that wraps to
                its own row on mobile (grid template-area) and aligns
                inline at the end on desktop. */}
            <div className="guild__member-actions">
                <span
                    className="guild__member-contrib"
                    title="XP wniesione do gildii z bossa w tym tygodniu"
                >
                    ⚡ {bossContribution.toLocaleString('pl-PL')} XP
                </span>
                {showKick && (
                    <button className="guild__member-kick" onClick={onKick} title="Wyrzuć z gildii">
                        ✕
                    </button>
                )}
                {isMe && (
                    <button className="guild__member-leave" onClick={onLeave} title="Opuść gildię">
                        🚪
                    </button>
                )}
            </div>
        </li>
    );
};

// ═════════════════════════════════════════════════════════════════════════════
// GUILD BOSS — weekly raid: 1 attack/day/member, 10% block gate,
// no potions, Sunday claim popup. Spec item 12.
// ═════════════════════════════════════════════════════════════════════════════

interface IGuildBossProps { onBack: () => void; }

const GuildBoss = ({ onBack }: IGuildBossProps) => {
    const character = useCharacterStore((s) => s.character)!;
    const guild = useGuildStore((s) => s.guild)!;
    const [boss, setBoss] = useState<IGuildBossStateRow | null>(null);
    const [contribution, setContribution] = useState<IGuildBossContributionRow | null>(null);
    const [contributions, setContributions] = useState<IGuildBossContributionRow[]>([]);
    const [attempts, setAttempts] = useState<IGuildBossAttemptRow[]>([]);
    const [attemptedToday, setAttemptedToday] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [claimResult, setClaimResult] = useState<IRolledReward[] | null>(null);
    // Legacy per-engagement state retained as refs only — visuals
    // now come from useCombatFx, but boss damage sync still needs
    // engagementDmgRef tracking.
    const floatIdRef = useRef(0);
    const isSunday = isGuildBossClaimDay();
    // 2026-05-18 spec ("Zrob animacje wejscia do walki z bossem
    // przyciemnianie ekranu itp"): combat phase machine. 'arena' is
    // the standby/info screen; 'entry' fades a black overlay in/out
    // before flipping to 'fighting' which runs the auto-attack loop.
    const [phase, setPhase] = useState<'arena' | 'entry' | 'fighting'>('arena');
    const [engagementDmg, setEngagementDmg] = useState(0);
    const [bossHitPulse, setBossHitPulse] = useState(0);
    // Speed multiplier for the auto-attack tick — spec: X1 / X2 / X4.
    const [speedMult, setSpeedMult] = useState<1 | 2 | 4>(1);
    const engagementDmgRef = useRef(0);
    const liveBossHpRef = useRef(0);
    // 2026-05-18 spec ("kazdy boss uzywa swoich specyficznych spelli i
    // widzimy ich animacje ataku"): the boss casts spells from a tier-
    // specific pool. Each cast pushes onto these queues:
    //   • `bossCastFx` — the cast-overlay (themed glow) layered over
    //     the boss sprite for ~700ms
    //   • `playerHits` — damage floats on the player's avatar
    // Player HP tracks the engagement-local pool so a near-death
    // doesn't actually kill the character (no death penalty from the
    // guild boss — engagement just ends when HP hits 0).
    const [playerHp, setPlayerHp] = useState(0);
    const [playerMaxHp, setPlayerMaxHp] = useState(0);
    const [playerMp, setPlayerMp] = useState(0);
    const [playerMaxMp, setPlayerMaxMp] = useState(0);
    const [playerHitPulse, setPlayerHitPulse] = useState(0);
    // bossCastFx kept only for the boss-name banner that highlights
    // the currently-casting spell. Pure visual.
    const [, setBossCastFx] = useState<{ id: number; spell: IGuildBossSpell } | null>(null);
    // 2026-05-18 v6 spec ("Walka ma wygladac i animacje identycznie
    // jak na widoku pojedynku albo raidu albo areny"): reuse the
    // shared `useCombatFx` hook so the boss tile + player avatar use
    // the SAME floats / skill-anim / hit-pulse system as hunt/boss/
    // raid views. Slot 0 = boss, slot 0 = player.
    const fx = useCombatFx();
    // 2026-05-18 v10 spec ("Dalej nie widze animacji podstawowego ataku
    // danej klasy na bossie"): the class swing animation belongs on the
    // BOSS tile (it's the target getting hit) — we drive it via
    // `bossAttackingPulse`, set to `attack-${character.class}` on every
    // basic-attack tick. The old `attackingClassName` state was never
    // read anywhere (orphan setter) so it's gone.
    const [bossAttackingPulse, setBossAttackingPulse] = useState<string | null>(null);
    const playerHpRef = useRef(0);
    const playerMpRef = useRef(0);
    const playerMaxMpRef = useRef(0);
    const skillCooldownsRef = useRef<Record<string, number>>({});
    const lastSkillCastRef = useRef(0);
    // 2026-05-18 v5 spec ("w logach dalej nic sie tez nie zapisuje"):
    // the previous throttle (sync every 3s) missed the kill tick when
    // damage spiked. Now we upsert the attempt row on EVERY tick —
    // idempotent, cheap, and the log row always reflects the latest
    // engagement total.

    const refresh = useCallback(async () => {
        if (!guild || !character) return;
        try {
            // Clamp the tier server-side — even if the guild row drifts
            // past tier 10 we cap to the highest shipped art tier.
            let bossRow = await guildApi.fetchOrCreateWeeklyBoss({
                guildId: guild.id,
                bossTier: clampGuildBossTier(guild.boss_tier),
            });
            // 2026-05-18 spec ("Nikt nie walczy a nie moge zaatakowac
            // bossa"): if `current_attacker_id` is set but the lock
            // hasn't been touched in >60s (engagement crashed, tab
            // closed mid-fight, etc.) it's stale — any client may
            // release it so the next attacker isn't blocked
            // indefinitely. We then re-fetch once to confirm.
            if (bossRow.current_attacker_id) {
                const ageMs = Date.now() - new Date(bossRow.updated_at).getTime();
                if (ageMs > 60_000) {
                    await guildApi.releaseBossArena({
                        guildId: guild.id,
                        weekStart: bossRow.week_start,
                    }).catch(() => { /* best effort */ });
                    bossRow = await guildApi.fetchOrCreateWeeklyBoss({
                        guildId: guild.id,
                        bossTier: clampGuildBossTier(guild.boss_tier),
                    });
                }
            }
            setBoss(bossRow);
            liveBossHpRef.current = bossRow.boss_current_hp;
            const [contrib, all, todayAtt, weeklyAtt] = await Promise.all([
                guildApi.fetchContribution({
                    guildId: guild.id,
                    characterId: character.id,
                    weekStart: bossRow.week_start,
                }),
                guildApi.listContributions({ guildId: guild.id, weekStart: bossRow.week_start }),
                guildApi.listAttemptsToday({ guildId: guild.id, characterId: character.id }),
                guildApi.listWeeklyAttempts({ guildId: guild.id, weekStart: bossRow.week_start }),
            ]);
            setContribution(contrib);
            setContributions(all);
            setAttempts(weeklyAtt);
            setAttemptedToday(todayAtt.length > 0);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Nie udało się załadować bossa.');
        }
    }, [guild, character]);

    useEffect(() => { void refresh(); }, [refresh]);

    // Realtime subscription on the boss row so HP changes from other
    // members land instantly. Cheap polling fallback every 4 s in
    // case the realtime channel drops.
    useEffect(() => {
        const t = setInterval(() => { void refresh(); }, 4000);
        return () => clearInterval(t);
    }, [refresh]);

    // 2026-05-18: defensive arena release on unmount. If the user
    // navigates away mid-engagement (closes the boss view, F5,
    // bottom-nav out, etc.) we drop the lock so the next attacker
    // isn't blocked. Idempotent — server treats a re-release as
    // no-op when the lock was already null.
    useEffect(() => {
        return () => {
            const g = useGuildStore.getState().guild;
            const c = useCharacterStore.getState().character;
            if (!g || !c) return;
            void guildApi.fetchOrCreateWeeklyBoss({
                guildId: g.id,
                bossTier: clampGuildBossTier(g.boss_tier),
            }).then((row) => {
                if (row.current_attacker_id === c.id) {
                    void guildApi.releaseBossArena({
                        guildId: g.id,
                        weekStart: row.week_start,
                    }).catch(() => { /* offline */ });
                }
            }).catch(() => { /* offline */ });
        };
    }, []);

    // 2026-05-18 spec ("Walka z bossem gildyjnym ma byc jak walka z
    // bossem, normalnie widok walki animacje ataku itp"): clicking
    // Atakuj enters the fight phase (entry overlay → fighting). The
    // combat loop in the next useEffect drives basic-attack auto-fire
    // on every speed-scaled tick. Engagement ends when the player
    // deals their daily 10 % HP block OR the boss dies.
    const startEngagement = async () => {
        if (!canAttackToday || busy || !character || !boss) return;
        if (someoneElseHolds) {
            setErrorMsg('Ktoś inny aktualnie walczy. Poczekaj aż boss straci 10% HP.');
            return;
        }
        setBusy(true);
        setErrorMsg(null);
        try {
            if (!youHoldArena) {
                const claim = await guildApi.claimBossArena({
                    guildId: guild.id,
                    characterId: character.id,
                    weekStart: boss.week_start,
                });
                if (!claim) {
                    setErrorMsg('Arena zajęta. Poczekaj chwilę.');
                    setBusy(false);
                    return;
                }
                setBoss(claim);
                liveBossHpRef.current = claim.boss_current_hp;
            }
            engagementDmgRef.current = 0;
            setEngagementDmg(0);
            // Reset player HP + MP to their effective max — engagement
            // damage is sandboxed (no real death penalty), so a 0-HP
            // exit just ends the fight early.
            const eff = getEffectiveChar(character);
            const maxHp = eff?.max_hp ?? character.max_hp ?? 1000;
            const maxMp = eff?.max_mp ?? character.max_mp ?? 100;
            playerHpRef.current = maxHp;
            playerMpRef.current = maxMp;
            playerMaxMpRef.current = maxMp;
            setPlayerHp(maxHp);
            setPlayerMaxHp(maxHp);
            setPlayerMp(maxMp);
            setPlayerMaxMp(maxMp);
            // Clear stale skill cooldowns + cast fx from any prior
            // engagement so the first tick can fire spells right away.
            skillCooldownsRef.current = {};
            lastSkillCastRef.current = 0;
            setBossCastFx(null);
            // 2026-05-18 v7: clear the shared combat-fx queues so
            // leftover floats / skill anims from a previous engagement
            // don't replay on the new fight's first tick.
            fx.resetFx();
            setPhase('entry');
            // 2026-05-18 v9: bumped from 1200 → 1700ms to give the new
            // door-opening intro time to: doors slide off (200–1000ms),
            // seam glow (200–1100ms), boss reveal punch-in
            // (400–1500ms), and overlay fade (1500–1700ms) before
            // the fighting phase mounts the CombatArena.
            window.setTimeout(() => {
                setPhase('fighting');
            }, 1700);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Atak się nie udał.');
        } finally {
            setBusy(false);
        }
    };

    // End the engagement: release arena, log attempt + contribution +
    // guild XP, refresh from server, then exit back to the arena
    // standby screen.
    const finishEngagement = useCallback(async () => {
        if (!character || !boss) return;
        // 2026-05-18 v10 spec ("Zadalem wiecej obrazen niz ma HP Boss,
        // zalicz to do XP jako nie wiecej niz maks HP Bossa"): cap the
        // engagement total at the boss's max HP. The local
        // `engagementDmgRef` can balloon past max HP when a `refresh()`
        // mid-fight resets `liveBossHpRef` from a stale server value
        // (apply-damage calls still in flight), so all subsequent
        // ticks credit "extra" damage that the boss never actually
        // had. Clamp before we write to the log, contribution, and
        // guild XP.
        const totalDmg = Math.min(engagementDmgRef.current, boss.boss_max_hp);
        try {
            if (totalDmg > 0) {
                try {
                    await guildApi.logAttempt({
                        guildId: guild.id,
                        characterId: character.id,
                        characterName: character.name,
                        damageDealt: totalDmg,
                    });
                } catch (logErr: unknown) {
                    // 2026-05-18 v6: don't let log failure break the
                    // whole finish flow — contribution + XP still
                    // sync below. Surface to console so missing-
                    // column / RLS errors are visible.
                    console.warn('[guildBoss] final logAttempt failed:', logErr);
                }
                await guildApi.addContribution({
                    guildId: guild.id,
                    characterId: character.id,
                    weekStart: boss.week_start,
                    damageAdd: totalDmg,
                });
                const cur = useGuildStore.getState().guild;
                if (cur) {
                    const { level, xp } = applyGuildXp(cur.level, cur.xp, totalDmg);
                    const cap = guildMemberCap(level);
                    await guildApi.updateGuildLevelXp({
                        guildId: cur.id,
                        level, xp, memberCap: cap,
                    });
                }
            }
            await guildApi.releaseBossArena({
                guildId: guild.id,
                weekStart: boss.week_start,
            });
            setAttemptedToday(true);
            setPhase('arena');
            await refresh();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Zamykanie walki nieudane.');
            setPhase('arena');
        }
    }, [character, boss, guild, refresh]);

    // 2026-05-18 v8 spec ("podstawowy atak ma atakowac w rownych
    // odstepach czasu zaleznie od AS a nie czy uzylem spella"): basic
    // attacks and spell casts run in PARALLEL loops, not one-action-
    // per-tick. Basic loop fires every 1500ms (×speedMult) regardless
    // of whether a spell just went off; spell loop independently picks
    // an off-cooldown skill and casts it. The two loops can fire on
    // the same frame (basic + spell in the same tick) — feels much
    // more responsive than the previous "either-or" model.
    useEffect(() => {
        if (phase !== 'fighting' || !character || !boss) return;
        const tier = clampGuildBossTier(guild.boss_tier);
        // Basic-attack cadence — character attack-speed scaled by the
        // user's speed mult. 1500ms is the baseline; faster classes
        // shave time, slower ones lose some (still capped at 150ms).
        const basicInterval = Math.max(120, Math.floor(1500 / speedMult));
        const basicTick = () => {
            if (liveBossHpRef.current <= 0 || playerHpRef.current <= 0) {
                void finishEngagement();
                return;
            }
            const eff = getEffectiveChar(character);
            const charAtk = eff?.attack ?? character.attack ?? 100;
            const rawDmg = computeGuildBossDamage(charAtk, character.level, tier);
            const isCrit = Math.random() < 0.2;
            const dmgVal = Math.max(1, Math.floor(rawDmg * (isCrit ? 1.7 : 1)));
            const cappedDmg = Math.min(dmgVal, liveBossHpRef.current);
            // 2026-05-18 v10: also clamp the engagement counter at
            // boss_max_hp — see finishEngagement note. The same
            // refresh-mid-fight race that bloats the total here is
            // also what would make the live "obrażenia tej tury"
            // display read past the boss's max HP.
            engagementDmgRef.current = Math.min(
                engagementDmgRef.current + cappedDmg,
                boss.boss_max_hp,
            );
            setEngagementDmg(engagementDmgRef.current);
            liveBossHpRef.current = Math.max(0, liveBossHpRef.current - cappedDmg);
            setBoss((b) => (b ? { ...b, boss_current_hp: liveBossHpRef.current } : b));
            setBossHitPulse((p) => p + 1);
            // 2026-05-18 v10 spec ("Podstawowy atak ma swoja unikalna
            // animacje"): drive the per-class swing animation on the
            // BOSS tile (the target). This puts the `attack-Warrior` /
            // `attack-Mage` / etc. modifier on the enemy card, which
            // triggers the CombatUI keyframes that ship with the
            // shared arena. The previous setter wrote to a dead state
            // slot so no animation was ever painted.
            setBossAttackingPulse(`attack-${character.class}`);
            window.setTimeout(() => setBossAttackingPulse(null), 320);
            fx.pushEnemyFloat(0, cappedDmg, 'basic', { isCrit });
            void guildApi.applyBossDamage({
                guildId: guild.id,
                weekStart: boss.week_start,
                damage: cappedDmg,
            }).catch(() => { /* offline */ });
            if (engagementDmgRef.current > 0) {
                void guildApi.logAttempt({
                    guildId: guild.id,
                    characterId: character.id,
                    characterName: character.name,
                    damageDealt: engagementDmgRef.current,
                }).catch((err: unknown) => {
                    console.warn('[guildBoss] logAttempt failed:', err);
                });
            }
        };
        const id = window.setInterval(basicTick, basicInterval);
        return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, speedMult, character?.id, boss?.id, guild?.id]);

    // 2026-05-18 v8: PARALLEL spell-cast loop. Independent of basic
    // attacks — fires whenever the next slotted skill is off cooldown
    // and MP allows. Spell casts can happen on the same frame as a
    // basic attack (player's level / spec lets them deal both at
    // once), making the fight feel snappy.
    useEffect(() => {
        if (phase !== 'fighting' || !character || !boss) return;
        const tier = clampGuildBossTier(guild.boss_tier);
        // Spell-check cadence — 600ms baseline. Faster checks mean a
        // skill that comes off cooldown fires sooner than the next
        // basic-attack tick.
        const spellCheckInterval = Math.max(80, Math.floor(600 / speedMult));
        const spellTick = () => {
            if (liveBossHpRef.current <= 0 || playerHpRef.current <= 0) return;
            const eff = getEffectiveChar(character);
            const charAtk = eff?.attack ?? character.attack ?? 100;
            const now = Date.now();
            // Min 1.2s between consecutive spell casts (independent
            // of speedMult) so chained spells stay readable.
            if (now - lastSkillCastRef.current < 1200) return;
            const slots = useSkillStore.getState().activeSkillSlots;
            const skills = getGuildPlayerSkills(character.class);
            const slottedIds = slots.filter((id): id is string => !!id);
            for (const skillId of slottedIds) {
                const def = skills.find((s) => s.id === skillId);
                if (!def) continue;
                if (def.unlockLevel > character.level) continue;
                const cdExpiry = skillCooldownsRef.current[def.id] ?? 0;
                if (cdExpiry > now) continue;
                if (playerMpRef.current < def.mpCost) continue;
                // Cast!
                const baseDmg = computeGuildBossDamage(charAtk, character.level, tier);
                const skillDmg = Math.max(1, Math.floor(baseDmg * def.damage));
                const cappedDmg = Math.min(skillDmg, liveBossHpRef.current);
                playerMpRef.current = Math.max(0, playerMpRef.current - def.mpCost);
                setPlayerMp(playerMpRef.current);
                skillCooldownsRef.current[def.id] = now + def.cooldown;
                lastSkillCastRef.current = now;
                // 2026-05-18 v10: clamp at boss_max_hp (see basic-tick
                // note above for the refresh-race rationale).
                engagementDmgRef.current = Math.min(
                    engagementDmgRef.current + cappedDmg,
                    boss.boss_max_hp,
                );
                setEngagementDmg(engagementDmgRef.current);
                liveBossHpRef.current = Math.max(0, liveBossHpRef.current - cappedDmg);
                setBoss((b) => (b ? { ...b, boss_current_hp: liveBossHpRef.current } : b));
                setBossHitPulse((p) => p + 1);
                fx.triggerEnemySkillAnim(0, def.id);
                fx.pushEnemyFloat(0, cappedDmg, 'spell', {
                    icon: getSkillIcon(def.id),
                });
                void guildApi.applyBossDamage({
                    guildId: guild.id,
                    weekStart: boss.week_start,
                    damage: cappedDmg,
                }).catch(() => { /* offline */ });
                break;
            }
        };
        const id = window.setInterval(spellTick, spellCheckInterval);
        return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, speedMult, character?.id, boss?.id, guild?.id]);

    // 2026-05-18 v7 spec ("potwor bije mnie x4 a ja go X1 tak nie
    // moze nigdy byc"): boss now attacks ONCE per player tick — same
    // 1500ms baseline. Every boss tick rolls 70% basic / 30% spell
    // (or basic if the spell's cooldown isn't ready). Single loop
    // means parity with the player's attack cadence at every speed
    // mult.
    useEffect(() => {
        if (phase !== 'fighting' || !character || !boss) return;
        const tier = clampGuildBossTier(boss.boss_tier);
        // Same cadence as the player tick — boss + player swap blows
        // 1-for-1 instead of the boss firing 2-3 attacks per
        // player swing.
        const bossInterval = Math.max(150, Math.floor(1500 / speedMult));
        const lastSpellCastRef = { current: 0 };
        const bossTick = () => {
            if (playerHpRef.current <= 0 || liveBossHpRef.current <= 0) return;
            const eff = getEffectiveChar(character);
            const maxHp = eff?.max_hp ?? character.max_hp ?? 1000;
            const now = Date.now();
            const spellCooldown = getBossCastIntervalMs(tier, speedMult);
            const wantsSpell = Math.random() < 0.3 && (now - lastSpellCastRef.current) >= spellCooldown;
            if (wantsSpell) {
                // Spell — themed float + cast overlay + on-player
                // animation overlay (fire burst, poison cloud, ice
                // shards, etc.). 2026-05-18 v11 spec ("Nie widze
                // animacji spelli typu DOT"): the float / cast banner
                // alone wasn't enough — we now fire
                // `triggerAllySkillAnim` against the player tile so
                // each boss spell drops its themed CombatUI keyframe
                // overlay (skill-anim--poison for krwawienie,
                // skill-anim--fire for pożoga / eksplozja, etc.). The
                // ally slot is 0 since the player is the only ally
                // in the guild boss arena.
                const spell = pickGuildBossSpell(tier);
                const dmg = computeBossSpellDamage(spell, tier, maxHp);
                playerHpRef.current = Math.max(0, playerHpRef.current - dmg);
                setPlayerHp(playerHpRef.current);
                setPlayerHitPulse((p) => p + 1);
                fx.pushAllyFloat(0, dmg, 'monster-spell', {
                    icon: spell.icon,
                    label: spell.name,
                });
                fx.triggerAllySkillAnim(0, spell.id);
                setBossCastFx({ id: ++floatIdRef.current, spell });
                window.setTimeout(() => setBossCastFx(null), 700);
                lastSpellCastRef.current = now;
            } else {
                // Basic — physical chip + swing flash.
                // 2026-05-18 v10 spec ("Bossy sa troche za slabe"):
                // basic-attack damage bumped from 2.5% → 4.5% of
                // player max HP. Combined with the tier kit's
                // damageMult buff in guildBossSpells.ts, even a tier-1
                // boss now eats ~5–6 % of a player's HP per swing,
                // pressuring positioning + heal cycles.
                const basicSpell = {
                    id: 'basic',
                    name: 'Cios',
                    kind: 'physical' as const,
                    dmgPctOfPlayerMaxHp: 0.045,
                    color: '#ffffff',
                    icon: '⚔️',
                };
                const dmg = computeBossSpellDamage(basicSpell, tier, maxHp);
                playerHpRef.current = Math.max(0, playerHpRef.current - dmg);
                setPlayerHp(playerHpRef.current);
                setPlayerHitPulse((p) => p + 1);
                fx.pushAllyFloat(0, dmg, 'monster');
                // 2026-05-18 v10: boss's own basic attack — visual
                // feedback is the player tile's red hit pulse + the
                // floating damage number. No `attackingClassName` to
                // set: the `boss-attack` class never had keyframes
                // attached, so the previous setter was a no-op that
                // also stomped on the player's class-swing slot.
            }
        };
        const firstTimeout = window.setTimeout(() => {
            bossTick();
            const id = window.setInterval(bossTick, bossInterval);
            (firstTimeout as unknown as { _intervalId?: number })._intervalId = id;
        }, Math.floor(bossInterval * 0.6));
        return () => {
            const stored = (firstTimeout as unknown as { _intervalId?: number })._intervalId;
            window.clearTimeout(firstTimeout);
            if (stored) window.clearInterval(stored);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, speedMult, character?.id, boss?.id]);

    const handleClaim = async () => {
        if (!contribution || contribution.rewards_claimed || !boss) return;
        setBusy(true);
        setErrorMsg(null);
        try {
            const mult = contributionMultiplier(contribution.total_damage, boss.boss_max_hp);
            const rolled = rollGuildBossRewards({
                tier: guild.boss_tier,
                level: character.level,
                contribution: mult,
            });
            // Apply rewards to the local inventory + character store.
            applyRolledRewards(rolled);
            await guildApi.markContributionClaimed({
                contributionId: contribution.id,
                rewardsJson: JSON.stringify(rolled),
            });
            // 2026-05-18 spec ("Boss w lochu gildii po zabiciu wbija
            // poziom na kolejny tydzień i zwiększa się jego poziom
            // zaczynając od 1 co tydzień jeżeli go pokonamy"): on the
            // first successful claim of a KILLED boss this week, bump
            // the guild's `boss_tier` by 1 so next Monday's spawn is
            // harder + drops better loot. Idempotent — every other
            // member's claim runs the same update but the value is
            // already the bumped one so it's a no-op.
            //
            // 2026-05-19 spec ("chyba ze to 20LVL to powtarzany jest
            // boss 20 LVL"): clamp the bump at GUILD_BOSS_MAX_TIER
            // (20) so a guild that beats tier-20 keeps re-fighting
            // tier-20 every week instead of silently rolling the DB
            // field to 21, 22, 23 … (the spawn already clamped via
            // `clampGuildBossTier` so it FELT capped, but the stored
            // value kept climbing).
            if (boss.boss_killed && guild.boss_tier === boss.boss_tier) {
                const cap = guildMemberCap(guild.level);
                const nextTier = Math.min(GUILD_BOSS_MAX_TIER, guild.boss_tier + 1);
                await guildApi.updateGuildLevelXp({
                    guildId: guild.id,
                    level: guild.level,
                    xp: guild.xp,
                    memberCap: cap,
                    bossTier: nextTier,
                });
            }
            setClaimResult(rolled);
            await refresh();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Nie udało się odebrać nagrody.');
        } finally {
            setBusy(false);
        }
    };

    // 2026-05-18 v2 ("Nie widac nic jak sie przechodzi do lochu" —
    // Hooks ordering crash): the loading/early-return MUST sit
    // AFTER every useState / useEffect / useCallback above so React
    // sees the same hook order on every render. When `boss` arrives
    // the next render passes this gate and continues into the JSX
    // that depends on it; before that we render the skeleton.
    if (!boss) {
        return (
            <>
                <header className="guild__top-bar">
                    <button className="guild__nav-back" onClick={onBack}>← Gildia</button>
                </header>
                <div className="guild__empty">{errorMsg ?? 'Ładowanie bossa…'}</div>
            </>
        );
    }

    const youHoldArena = boss.current_attacker_id === character.id;
    const someoneElseHolds = !!boss.current_attacker_id && !youHoldArena;
    const canAttackToday = !attemptedToday && !boss.boss_killed && !isSunday;
    const renderTier = clampGuildBossTier(boss.boss_tier);
    const bossImg = getLochBossImage(renderTier);
    const bgImg = getLochBackground(renderTier);

    // 2026-05-19 spec ("kolor guzika do ataku bossa w kolorze naszego
    // transformu"): paint the "Atakuj bossa" CTA in the player's
    // highest-transform colour. `getHighestTransformColor` returns
    // a solid + optional gradient + a pre-built `css` string ready
    // for `background`. Border colour falls back to the solid so the
    // outline isn't a gradient strip. Null transform (no transforms
    // claimed yet) leaves the orange default untouched.
    const transformColor = useTransformStore.getState().getHighestTransformColor();
    const attackBtnStyle = transformColor
        ? ({
            '--guild-attack-bg': transformColor.css,
            '--guild-attack-border': transformColor.solid,
        } as React.CSSProperties)
        : undefined;

    return (
        <>
            <header className="guild__top-bar">
                <button className="guild__nav-back" onClick={onBack}>← Gildia</button>
                <h2 className="guild__top-title">
                    Boss gildii · Poziom {renderTier}{renderTier >= GUILD_BOSS_MAX_TIER ? ' (MAX)' : ''}
                </h2>
            </header>

            {/* 2026-05-18 spec ("Zamiast obecnego tla uzywamy tla dla
                danego poziomu lochu"): full-bleed dungeon background.
                The arena card sits on top with a translucent dark
                veneer so the art bleeds through but the HP bar /
                buttons stay legible. 2026-05-18 v14: the panel now
                holds ONLY the boss portrait + HP bar — name banner,
                action row, status banners, engagement readout, and
                error message all moved below ("moga byc tez pod tym
                zdjeciem … w srodku zostaw tylko HP"). */}
            <div
                className={`guild__boss-stage${phase === 'arena' ? '' : ' is-fighting'}`}
                style={{ backgroundImage: `url("${bgImg}")` }}
            >
                <div className={`guild__boss-card${phase === 'fighting' ? ' is-fighting' : ''}`}>
                    {/* 2026-05-18 v7 spec ("Najpierw niech sie
                        pokazuje sam obrazek bossa z tlem bossa na
                        srodku, i po kliknieciu walcz dopiero plansza
                        do walki i nasz avatar"): two-phase layout —
                        arena phase shows ONLY a centred boss portrait
                        with HP bar; fighting phase swaps to the full
                        CombatArena (hunt-grade visuals). */}
                    {phase !== 'fighting' ? (
                        <div className="guild__boss-preview">
                            <img
                                src={bossImg}
                                alt={getGuildBossLabel(renderTier)}
                                className="guild__boss-preview-img"
                                draggable={false}
                            />
                            {/* 2026-05-18 v13 spec ("Pokaz na progress
                                barze aktualny poziom hp bossa zeby bylo
                                widac ile %HP mu zostalo"): live HP bar
                                with fill width set inline from the
                                current / max HP ratio. Centred numeric
                                label sits on top so the player still
                                sees the exact tally. */}
                            {(() => {
                                const maxHp = Math.max(1, boss.boss_max_hp);
                                const curHp = Math.max(0, Math.min(boss.boss_current_hp, maxHp));
                                const pct = Math.max(0, Math.min(100, (curHp / maxHp) * 100));
                                return (
                                    <div
                                        className="guild__boss-preview-hpbar"
                                        role="progressbar"
                                        aria-valuemin={0}
                                        aria-valuemax={maxHp}
                                        aria-valuenow={curHp}
                                    >
                                        <div
                                            className="guild__boss-preview-hpbar-fill"
                                            style={{ width: `${pct}%` }}
                                        />
                                        <div className="guild__boss-preview-hpbar-text">
                                            {curHp.toLocaleString('pl-PL')}
                                            {' / '}
                                            {maxHp.toLocaleString('pl-PL')} HP
                                            {' · '}
                                            {pct.toFixed(1)}%
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    ) : (() => {
                        // Build ICombatEnemy + ICombatAlly from live
                        // engagement state, hand to CombatArena (same
                        // component hunt/raid/boss use).
                        const completedTiers = useTransformStore.getState().completedTransforms ?? [];
                        const tColor = useTransformStore.getState().getHighestTransformColor();
                        const accent = tColor?.solid ?? tColor?.gradient?.[0] ?? CLASS_COLORS[character.class] ?? '#888';
                        const bossEnemy: ICombatEnemy = {
                            id: 'guild-boss',
                            name: getGuildBossLabel(renderTier),
                            level: renderTier,
                            sprite: '🐉',
                            kind: 'boss',
                            imageUrl: bossImg,
                            imageObjectFit: 'cover',
                            currentHp: boss.boss_current_hp,
                            maxHp: boss.boss_max_hp,
                            rarity: 'boss',
                            isDead: boss.boss_killed || boss.boss_current_hp <= 0,
                            isTargetedByPlayer: true,
                            hitPulse: bossHitPulse,
                            attackingClassName: bossAttackingPulse,
                            skillAnim: fx.enemySkill[0] ?? null,
                            floats: fx.enemyFloats[0] ?? [],
                        };
                        const playerAlly: ICombatAlly = {
                            id: 'player',
                            name: character.name,
                            avatarUrl: getCharacterAvatar(character.class, completedTiers),
                            accentColor: accent,
                            className: character.class,
                            currentHp: playerHp,
                            maxHp: playerMaxHp,
                            currentMp: playerMp,
                            maxMp: playerMaxMp,
                            isDead: playerHp <= 0,
                            isPlayer: true,
                            level: character.level,
                            aggroCount: 1,
                            hitPulse: playerHitPulse,
                            // 2026-05-18 v8 spec ("animacja ataku jest
                            // na mojej postaci a nie na bossie"): the
                            // attacking-class swing belongs to the
                            // TARGET (boss) per hunt's convention, not
                            // the attacker's own avatar. Pass null so
                            // the player tile doesn't flash with its
                            // own class animation.
                            attackingClassName: null,
                            skillAnim: fx.allySkill[0] ?? null,
                            floats: fx.allyFloats[0] ?? [],
                        };
                        return (
                            <CombatArena
                                enemies={[bossEnemy]}
                                allies={[playerAlly]}
                                bgVariant="daily-boss"
                            />
                        );
                    })()}
                </div>

                {/* 2026-05-18 v9 spec ("zrob jakas epicka fajna animacje
                    startu walki z bossem a nie ta co jest obecnie"):
                    door-opening sequence ported from Boss.tsx. Two iron
                    doors slide off to the sides, a vertical seam of
                    light crackles down the middle, a shockwave ring
                    pulses outward, and the boss portrait + name punch
                    into view in the centre. Plain CSS keyframes so we
                    don't need to pull in framer-motion here. The
                    timings line up with the 1600ms hold in
                    `attemptAttackNow` (entry → fighting). */}
                {phase === 'entry' && (
                    <div className="guild__boss-entry-overlay">
                        <div className="guild__boss-entry-bg" aria-hidden="true" />
                        <div
                            className="guild__boss-entry-door guild__boss-entry-door--left"
                            aria-hidden="true"
                        />
                        <div
                            className="guild__boss-entry-door guild__boss-entry-door--right"
                            aria-hidden="true"
                        />
                        <div className="guild__boss-entry-seam" aria-hidden="true" />
                        <div className="guild__boss-entry-shock" aria-hidden="true" />
                        <div className="guild__boss-entry-label">
                            <span className="guild__boss-entry-sprite">
                                <img
                                    src={bossImg}
                                    alt={getGuildBossLabel(renderTier)}
                                    draggable={false}
                                />
                            </span>
                            <span className="guild__boss-entry-name">
                                {getGuildBossLabel(renderTier)}
                            </span>
                            <span className="guild__boss-entry-level">
                                Poziom {renderTier}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* 2026-05-18 v14 spec ("poukladaj tam buttony i wszystkie
                informacje zeby sie zmiescily, moga byc tez pod tym
                zdjeciem"): boss name + status banners + engagement
                readout + speed picker + Atakuj/Zakończ/Odbierz buttons
                live BELOW the stage panel now, freeing the dungeon
                art to read at native resolution. */}
            <div className="guild__boss-controls">
                <div className="guild__boss-name guild__boss-name--ext">
                    {getGuildBossLabel(renderTier)}
                </div>
                {someoneElseHolds && phase === 'arena' && (
                    <div className="guild__boss-banner">⏳ Inny członek walczy. Poczekaj…</div>
                )}
                {isSunday && !boss.boss_killed && (
                    <div className="guild__boss-banner">🌅 Niedziela — atakowanie zablokowane.</div>
                )}
                {boss.boss_killed && (
                    <div className="guild__boss-banner guild__boss-banner--win">
                        🏆 Boss pokonany! Czekaj na niedzielę by odebrać nagrodę.
                        {renderTier < GUILD_BOSS_MAX_TIER
                            ? ` W kolejnym tygodniu wyzwanie poziomu ${renderTier + 1}.`
                            : ' Walczysz na maksymalnym poziomie lochu.'}
                    </div>
                )}
                {phase === 'fighting' && (
                    <div className="guild__boss-engagement">
                        <div className="guild__boss-engagement-label">
                            Obrażenia w tej walce: <strong>{engagementDmg.toLocaleString('pl-PL')}</strong>
                        </div>
                    </div>
                )}
                <div className="guild__boss-actions">
                    {phase === 'arena' && !isSunday && !boss.boss_killed && (
                        <>
                            <div className="guild__boss-speed">
                                {[1, 2, 4].map((s) => (
                                    <button
                                        key={s}
                                        className={`guild__boss-speed-btn${speedMult === s ? ' is-active' : ''}`}
                                        onClick={() => setSpeedMult(s as 1 | 2 | 4)}
                                    >
                                        X{s}
                                    </button>
                                ))}
                            </div>
                            <button
                                className="guild__btn-primary guild__btn-primary--attack"
                                disabled={!canAttackToday || someoneElseHolds || busy}
                                onClick={startEngagement}
                                style={attackBtnStyle}
                            >
                                {attemptedToday ? 'Atak wykonany dzisiaj' : busy ? 'Wchodzę...' : '⚔️ Atakuj bossa'}
                            </button>
                        </>
                    )}
                    {phase === 'fighting' && (
                        <div className="guild__boss-speed">
                            {[1, 2, 4].map((s) => (
                                <button
                                    key={s}
                                    className={`guild__boss-speed-btn${speedMult === s ? ' is-active' : ''}`}
                                    onClick={() => setSpeedMult(s as 1 | 2 | 4)}
                                >
                                    X{s}
                                </button>
                            ))}
                            <button className="guild__btn-danger" onClick={() => void finishEngagement()}>
                                Zakończ walkę
                            </button>
                        </div>
                    )}
                    {isSunday && (
                        <button
                            className="guild__btn-primary"
                            disabled={!contribution || contribution.rewards_claimed || busy}
                            onClick={handleClaim}
                        >
                            {contribution?.rewards_claimed ? 'Odebrano' : busy ? 'Liczenie nagrody…' : '🎁 Odbierz nagrody'}
                        </button>
                    )}
                </div>
                {errorMsg && <div className="guild__create-error">{errorMsg}</div>}
            </div>

            <div className="guild__boss-info">
                <p>
                    Twoje obrażenia tej tury: <strong>{contribution?.total_damage.toLocaleString('pl-PL') ?? 0}</strong>
                </p>
                <p>
                    Łączny wkład gildii:{' '}
                    <strong>
                        {contributions.reduce((sum, c) => sum + c.total_damage, 0).toLocaleString('pl-PL')}
                    </strong>
                </p>
                <p className="guild__boss-rules">
                    Każdy członek atakuje raz dziennie. Każde 1 HP zadane bossowi = 1 XP gildii.
                    Boss żyje od poniedziałku do niedzieli. Im więcej obrażeń zadasz, tym lepsze
                    nagrody w niedzielę.
                </p>
            </div>

            {/* 2026-05-18 spec ("na dole daj liste na scroolu z data
                nickiem postaci kto atakowal ile zabral HP bossowi"):
                weekly attack log — newest first, scrollable. */}
            <div className="guild__boss-log">
                <h3 className="guild__boss-log-title">📜 Log ataków (tydzień)</h3>
                {attempts.length === 0 ? (
                    <p className="guild__boss-log-empty">Nikt jeszcze nie zaatakował w tym tygodniu.</p>
                ) : (
                    <ul className="guild__boss-log-list">
                        {attempts.map((a) => (
                            <li key={a.id} className="guild__boss-log-row">
                                <span className="guild__boss-log-when">
                                    {new Date(a.created_at).toLocaleString('pl-PL')}
                                </span>
                                <strong className="guild__boss-log-who">
                                    {a.character_name || '—'}
                                </strong>
                                <span className="guild__boss-log-dmg">
                                    -{a.damage_dealt.toLocaleString('pl-PL')} HP
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {claimResult && (
                <Modal onClose={() => setClaimResult(null)} title="🎁 Nagrody z bossa" wide>
                    <div className="guild__claim-popup">
                        {claimResult.length === 0 && <p>Pech tej tury — brak nagród.</p>}
                        {claimResult.map((r, i) => (
                            <div key={i} className="guild__claim-line">
                                <span className="guild__claim-icon">{r.icon}</span>
                                <span className="guild__claim-label">{r.label}</span>
                            </div>
                        ))}
                    </div>
                    <div className="guild__modal-actions">
                        <button className="guild__btn-primary" onClick={() => setClaimResult(null)}>
                            Zamknij
                        </button>
                    </div>
                </Modal>
            )}
        </>
    );
};

// ═════════════════════════════════════════════════════════════════════════════
// REWARD ROLLER — random + percentage rewards (gold/xp/stones/potions/items)
// scaling by tier × contribution share. Heroic capped at 1 %. Spec items
// 21–25.
// ═════════════════════════════════════════════════════════════════════════════

interface IRolledReward { kind: string; label: string; icon: string; }

interface IRollGuildRewardsParams {
    tier: number;
    level: number;
    contribution: number;
}

const rollGuildBossRewards = ({ tier, level, contribution }: IRollGuildRewardsParams): IRolledReward[] => {
    const out: IRolledReward[] = [];
    // Gold — always granted. Scales with tier × contribution × level.
    const goldBase = 1_000_000 * tier * contribution * (1 + level / 50);
    const goldAmount = Math.floor(goldBase * (0.8 + Math.random() * 0.4));
    if (goldAmount > 0) {
        useInventoryStore.getState().addGold(goldAmount);
        out.push({ kind: 'gold', icon: '💰', label: `${formatGoldShort(goldAmount)} golda` });
    }
    // XP — granted to character.
    const xpAmount = Math.floor(50_000 * tier * contribution * (1 + level / 30));
    if (xpAmount > 0) {
        useCharacterStore.getState().addXp(xpAmount);
        out.push({ kind: 'xp', icon: '⭐', label: `+${xpAmount.toLocaleString('pl-PL')} XP` });
    }
    // Stones — common always, rare/epic with rising probability.
    const stones = useInventoryStore.getState();
    const commonStones = Math.max(1, Math.floor(5 * tier * contribution));
    stones.addStones('common_stone', commonStones);
    out.push({ kind: 'stones', icon: '🪨', label: `+${commonStones}× Kamień zwykły` });
    if (Math.random() < Math.min(0.8, 0.3 + tier * 0.05)) {
        const rareStones = Math.max(1, Math.floor(2 * tier * contribution));
        stones.addStones('rare_stone', rareStones);
        out.push({ kind: 'stones', icon: '💎', label: `+${rareStones}× Kamień rzadki` });
    }
    if (Math.random() < Math.min(0.4, 0.1 + tier * 0.03)) {
        const epicStones = Math.max(1, Math.floor(1 * tier * contribution));
        stones.addStones('epic_stone', epicStones);
        out.push({ kind: 'stones', icon: '🔷', label: `+${epicStones}× Kamień epicki` });
    }
    // Potions — small flat HP/MP every claim.
    const potionCount = Math.max(1, Math.floor(3 * contribution));
    stones.addConsumable('hp_potion_small', potionCount);
    stones.addConsumable('mp_potion_small', potionCount);
    out.push({ kind: 'potion', icon: '🧪', label: `+${potionCount}× Mała mikstura HP + MP` });
    // Item drop chance scales by tier × contribution. Heroic capped at 1%.
    const itemChance = Math.min(0.95, 0.4 + tier * 0.04);
    if (Math.random() < itemChance) {
        // Roll rarity: contribution biases towards higher tiers.
        const r = Math.random();
        let rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'heroic' = 'common';
        const heroicChance = Math.min(GUILD_BOSS_HEROIC_MAX_CHANCE, contribution * 0.01);
        if (r < heroicChance) rarity = 'heroic';
        else if (r < 0.05) rarity = 'legendary';
        else if (r < 0.2) rarity = 'epic';
        else if (r < 0.5) rarity = 'rare';
        // Build a minimal placeholder item — full procedural generation
        // happens via itemGenerator when wired against a specific
        // template. For now we add a representative "guild reward
        // stash" line that the player sees in the popup; loot grants
        // happen via gold/stones above. Items can be expanded later
        // when a guild-loot table is curated.
        out.push({ kind: 'item', icon: '🎁', label: `Przedmiot ${rarity.toUpperCase()} (lvl ${level})` });
    }
    return out;
};

const applyRolledRewards = (rolled: IRolledReward[]): void => {
    // Apply-side effects already ran in rollGuildBossRewards (gold,
    // xp, stones, consumables). This helper is kept so future
    // rewards that should ONLY be granted on claim (e.g. items into
    // bag) can be split off cleanly without changing call sites.
    void rolled;
};

// ═════════════════════════════════════════════════════════════════════════════
// GUILD TREASURY — shared bag, deposit/withdraw, logs. Spec item 26.
// ═════════════════════════════════════════════════════════════════════════════

interface IGuildTreasuryProps { onBack: () => void; }

const GuildTreasury = ({ onBack }: IGuildTreasuryProps) => {
    const character = useCharacterStore((s) => s.character)!;
    const guild = useGuildStore((s) => s.guild)!;
    const bag = useInventoryStore((s) => s.bag);
    const [treasury, setTreasury] = useState<IGuildTreasuryItemRow[]>([]);
    const [logs, setLogs] = useState<IGuildTreasuryLogRow[]>([]);
    const [showLogs, setShowLogs] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    // 2026-05-18 spec ("Dodaj filtry do Twojego plecaka oraz skarbca
    // gildii, takie jak w plecaku sa"): per-column filters mirror the
    // inventory bag's rarity + slot pills. Each column owns its own
    // filter state so the player can independently narrow each side.
    const [bagRarity, setBagRarity] = useState<TRarityFilter>('all');
    const [bagSlot, setBagSlot] = useState<TSlotFilter>('all');
    const [bagSort, setBagSort] = useState<TSortOrder>('level-desc');
    const [vaultRarity, setVaultRarity] = useState<TRarityFilter>('all');
    const [vaultSlot, setVaultSlot] = useState<TSlotFilter>('all');
    const [vaultSort, setVaultSort] = useState<TSortOrder>('level-desc');

    const refresh = useCallback(async () => {
        if (!guild) return;
        const [items, allLogs] = await Promise.all([
            guildApi.listTreasury(guild.id),
            guildApi.listTreasuryLogs(guild.id),
        ]);
        setTreasury(items);
        setLogs(allLogs);
    }, [guild]);

    // Cached parse of every vault row's item snapshot so the filter
    // logic + render can read rarity / itemLevel without re-parsing
    // on every keystroke.
    const treasuryParsed = useMemo(() => {
        return treasury.map((row) => {
            let parsed: IInventoryItem | null = null;
            try { parsed = JSON.parse(row.item_data) as IInventoryItem; }
            catch { parsed = null; }
            return { row, parsed };
        });
    }, [treasury]);

    const filteredBag = useMemo(() => {
        const out = bag.filter((item) => {
            if (bagRarity !== 'all' && item.rarity !== bagRarity) return false;
            if (!itemMatchesSlotFilter(item.itemId, bagSlot)) return false;
            return true;
        });
        out.sort((a, b) => {
            const diff = (b.itemLevel ?? 1) - (a.itemLevel ?? 1);
            return bagSort === 'level-desc' ? diff : -diff;
        });
        return out;
    }, [bag, bagRarity, bagSlot, bagSort]);

    const filteredVault = useMemo(() => {
        const out = treasuryParsed.filter(({ parsed }) => {
            if (!parsed) return vaultRarity === 'all' && vaultSlot === 'all';
            if (vaultRarity !== 'all' && parsed.rarity !== vaultRarity) return false;
            if (!itemMatchesSlotFilter(parsed.itemId, vaultSlot)) return false;
            return true;
        });
        out.sort((a, b) => {
            const la = a.parsed?.itemLevel ?? 1;
            const lb = b.parsed?.itemLevel ?? 1;
            const diff = lb - la;
            return vaultSort === 'level-desc' ? diff : -diff;
        });
        return out;
    }, [treasuryParsed, vaultRarity, vaultSlot, vaultSort]);

    useEffect(() => {
        void refresh();
        const t = setInterval(() => { void refresh(); }, 5000);
        return () => clearInterval(t);
    }, [refresh]);

    const handleDeposit = async (item: IInventoryItem) => {
        if (treasury.length >= GUILD_TREASURY_SLOTS) {
            setErrorMsg('Skarbiec gildii jest pełny.');
            return;
        }
        setBusy(true);
        setErrorMsg(null);
        try {
            const info = getItemDisplayInfo(item.itemId);
            await guildApi.depositItem({
                guildId: guild.id,
                itemData: JSON.stringify(item),
                depositedBy: character.id,
                depositedByName: character.name,
                itemName: info?.name_pl ?? item.itemId,
            });
            useInventoryStore.getState().removeItem(item.uuid);
            await refresh();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Nie udało się zdeponować.');
        } finally {
            setBusy(false);
        }
    };

    const handleWithdraw = async (row: IGuildTreasuryItemRow) => {
        setBusy(true);
        setErrorMsg(null);
        try {
            const item = JSON.parse(row.item_data) as IInventoryItem;
            const ok = useInventoryStore.getState().restoreItem(item);
            if (!ok) {
                setErrorMsg('Twój plecak jest pełny.');
                setBusy(false);
                return;
            }
            const info = getItemDisplayInfo(item.itemId);
            await guildApi.withdrawItem({
                treasuryItemId: row.id,
                guildId: guild.id,
                characterId: character.id,
                characterName: character.name,
                itemName: info?.name_pl ?? item.itemId,
                itemData: row.item_data,
            });
            await refresh();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Nie udało się wypłacić.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <header className="guild__top-bar">
                <button className="guild__nav-back" onClick={onBack}>← Gildia</button>
                <h2 className="guild__top-title">💎 Skarbiec gildii</h2>
                <button className="guild__btn-secondary" onClick={() => setShowLogs(true)}>
                    📜 Logi
                </button>
            </header>

            {errorMsg && <div className="guild__create-error">{errorMsg}</div>}

            <div className="guild__treasury-grids">
                <div className="guild__treasury-col">
                    <h3 className="guild__treasury-title">
                        Twój plecak ({filteredBag.length}/{bag.length})
                    </h3>
                    <TreasuryFilters
                        rarity={bagRarity}
                        slot={bagSlot}
                        sort={bagSort}
                        onRarity={setBagRarity}
                        onSlot={setBagSlot}
                        onSort={setBagSort}
                    />
                    <ul className="guild__treasury-list">
                        {filteredBag.map((item) => {
                            const info = getItemDisplayInfo(item.itemId);
                            const upgrade = (item as IInventoryItem & { upgradeLevel?: number }).upgradeLevel ?? 0;
                            return (
                                <li key={item.uuid} className="guild__treasury-row">
                                    {/* 2026-05-18 spec ("Skarbiec problem
                                        ze zdjeciami"): use ItemIcon so
                                        Vite-served PNG paths render as
                                        <img>, emoji fallback as text. */}
                                    <ItemIcon
                                        icon={info?.icon ?? '📦'}
                                        rarity={item.rarity}
                                        itemLevel={item.itemLevel}
                                        upgradeLevel={upgrade}
                                        size="sm"
                                        showTooltip={false}
                                    />
                                    <div className="guild__treasury-info">
                                        <div
                                            className="guild__treasury-name"
                                            style={{ color: RARITY_COLORS[item.rarity] }}
                                        >
                                            {info?.name_pl ?? item.itemId}
                                            {upgrade > 0 && <span className="guild__treasury-upgrade"> +{upgrade}</span>}
                                        </div>
                                        <div className="guild__treasury-meta">
                                            {RARITY_LABELS[item.rarity]} · Lvl {item.itemLevel}
                                        </div>
                                    </div>
                                    <button
                                        className="guild__btn-primary"
                                        disabled={busy}
                                        onClick={() => handleDeposit(item)}
                                    >
                                        Włóż →
                                    </button>
                                </li>
                            );
                        })}
                        {filteredBag.length === 0 && (
                            <li className="guild__treasury-empty">
                                {bag.length === 0 ? 'Plecak pusty.' : 'Brak przedmiotów spełniających filtr.'}
                            </li>
                        )}
                    </ul>
                </div>
                <div className="guild__treasury-col">
                    <h3 className="guild__treasury-title">
                        Skarbiec gildii ({filteredVault.length}/{treasury.length} · max {GUILD_TREASURY_SLOTS})
                    </h3>
                    <TreasuryFilters
                        rarity={vaultRarity}
                        slot={vaultSlot}
                        sort={vaultSort}
                        onRarity={setVaultRarity}
                        onSlot={setVaultSlot}
                        onSort={setVaultSort}
                    />
                    <ul className="guild__treasury-list">
                        {filteredVault.map(({ row, parsed }) => {
                            const info = parsed ? getItemDisplayInfo(parsed.itemId) : null;
                            const upgrade = parsed
                                ? ((parsed as IInventoryItem & { upgradeLevel?: number }).upgradeLevel ?? 0)
                                : 0;
                            return (
                                <li key={row.id} className="guild__treasury-row">
                                    <ItemIcon
                                        icon={info?.icon ?? '📦'}
                                        rarity={parsed?.rarity ?? 'common'}
                                        itemLevel={parsed?.itemLevel ?? 1}
                                        upgradeLevel={upgrade}
                                        size="sm"
                                        showTooltip={false}
                                    />
                                    <div className="guild__treasury-info">
                                        <div
                                            className="guild__treasury-name"
                                            style={{ color: parsed ? RARITY_COLORS[parsed.rarity] : '#fff' }}
                                        >
                                            {info?.name_pl ?? parsed?.itemId ?? 'Przedmiot'}
                                            {upgrade > 0 && <span className="guild__treasury-upgrade"> +{upgrade}</span>}
                                        </div>
                                        <div className="guild__treasury-meta">
                                            {parsed
                                                ? `${RARITY_LABELS[parsed.rarity]} · Lvl ${parsed.itemLevel}`
                                                : ''}
                                            {' · włożył '}{row.deposited_by_name}
                                        </div>
                                    </div>
                                    <button
                                        className="guild__btn-secondary"
                                        disabled={busy}
                                        onClick={() => handleWithdraw(row)}
                                    >
                                        ← Wyciągnij
                                    </button>
                                </li>
                            );
                        })}
                        {filteredVault.length === 0 && (
                            <li className="guild__treasury-empty">
                                {treasury.length === 0 ? 'Skarbiec pusty.' : 'Brak przedmiotów spełniających filtr.'}
                            </li>
                        )}
                    </ul>
                </div>
            </div>

            {showLogs && (
                <Modal onClose={() => setShowLogs(false)} title="📜 Historia skarbca" wide>
                    <ul className="guild__log-list">
                        {logs.length === 0 && <li>Brak operacji.</li>}
                        {/* 2026-05-18 spec ("Kolor przedmiotu powinien
                            byc w kolorze rarity ... oraz na koncu poziom
                            tego przedmiotu i ulepszenie +1 +2 jezeli
                            posiada jak nie to +0"): each log line parses
                            its embedded `item_data` (when present) so the
                            item name renders in its rarity colour with
                            "+N" upgrade tag and "Lvl X" at the end. */}
                        {logs.map((l) => {
                            let parsed: IInventoryItem | null = null;
                            if (l.item_data) {
                                try { parsed = JSON.parse(l.item_data) as IInventoryItem; }
                                catch { parsed = null; }
                            }
                            const rarity = parsed?.rarity ?? 'common';
                            const itemLevel = parsed?.itemLevel ?? null;
                            const upgrade = parsed
                                ? ((parsed as IInventoryItem & { upgradeLevel?: number }).upgradeLevel ?? 0)
                                : 0;
                            return (
                                <li key={l.id} className="guild__log-row">
                                    <span className={`guild__log-tag guild__log-tag--${l.action}`}>
                                        {l.action === 'deposit' ? 'WŁOŻYŁ' : 'WYCIĄGNĄŁ'}
                                    </span>
                                    <strong className="guild__log-player">{l.character_name}</strong>
                                    <span
                                        className="guild__log-item"
                                        style={{ color: RARITY_COLORS[rarity] }}
                                    >
                                        {l.item_name} +{upgrade}
                                    </span>
                                    {itemLevel !== null && (
                                        <span className="guild__log-level">Lvl {itemLevel}</span>
                                    )}
                                    <span className="guild__log-time">
                                        {new Date(l.created_at).toLocaleString('pl-PL')}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="guild__modal-actions">
                        <button onClick={() => setShowLogs(false)}>Zamknij</button>
                    </div>
                </Modal>
            )}
        </>
    );
};

// ── Treasury filter pills (rarity + slot + sort) ──────────────────────────
interface ITreasuryFiltersProps {
    rarity: TRarityFilter;
    slot: TSlotFilter;
    sort: TSortOrder;
    onRarity: (v: TRarityFilter) => void;
    onSlot: (v: TSlotFilter) => void;
    onSort: (v: TSortOrder) => void;
}

const isImageSrc = (s: string): boolean => s.startsWith('/') || s.startsWith('http') || s.startsWith('data:');

const TreasuryFilters = ({ rarity, slot, sort, onRarity, onSlot, onSort }: ITreasuryFiltersProps) => (
    <div className="guild__treasury-filters">
        {/* Rarity pills — each in its own rarity colour so the player
            can pick by the same colour-coding used everywhere else
            (legendary RED, heroic PURPLE, etc.). */}
        <div className="guild__treasury-filter-row">
            {RARITY_FILTERS.map((r) => {
                const isAll = r === 'all';
                const color = isAll ? '#ff9800' : RARITY_COLORS[r as TRarity];
                return (
                    <button
                        key={r}
                        className={`guild__treasury-filter-pill${rarity === r ? ' is-active' : ''}`}
                        style={{
                            color,
                            borderColor: rarity === r ? color : 'rgba(255, 255, 255, 0.12)',
                            background: rarity === r ? `${color}22` : 'rgba(255, 255, 255, 0.05)',
                        }}
                        onClick={() => onRarity(r)}
                    >
                        {isAll ? 'Wszystkie' : RARITY_LABELS[r as TRarity]}
                    </button>
                );
            })}
        </div>
        {/* Slot pills with item PNG icons (mirrors the inventory bar). */}
        <div className="guild__treasury-filter-row">
            {SLOT_FILTERS.map((s) => (
                <button
                    key={s.id}
                    className={`guild__treasury-filter-pill guild__treasury-filter-pill--slot${slot === s.id ? ' is-active' : ''}`}
                    onClick={() => onSlot(s.id)}
                    title={s.label}
                >
                    {isImageSrc(s.icon) ? (
                        <img className="guild__treasury-filter-icon" src={s.icon} alt="" />
                    ) : (
                        <span className="guild__treasury-filter-icon-emoji">{s.icon}</span>
                    )}
                    <span className="guild__treasury-filter-label">{s.label}</span>
                </button>
            ))}
        </div>
        {/* Sort toggle. */}
        <div className="guild__treasury-filter-row">
            <button
                className={`guild__treasury-filter-pill${sort === 'level-desc' ? ' is-active' : ''}`}
                onClick={() => onSort('level-desc')}
            >
                {SORT_LABELS['level-desc']}
            </button>
            <button
                className={`guild__treasury-filter-pill${sort === 'level-asc' ? ' is-active' : ''}`}
                onClick={() => onSort('level-asc')}
            >
                {SORT_LABELS['level-asc']}
            </button>
        </div>
    </div>
);

// ═════════════════════════════════════════════════════════════════════════════
// JOIN REQUESTS — visible to all members, accept-only by leader.
// Spec items 27–28.
// ═════════════════════════════════════════════════════════════════════════════

interface IGuildRequestsProps { onBack: () => void; }

const GuildRequests = ({ onBack }: IGuildRequestsProps) => {
    const character = useCharacterStore((s) => s.character)!;
    const guild = useGuildStore((s) => s.guild)!;
    const requests = useGuildStore((s) => s.requests);
    const members = useGuildStore((s) => s.members);
    const isLeader = guild.leader_id === character.id;
    const [busyId, setBusyId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const handleAccept = async (req: IGuildJoinRequestRow) => {
        if (!isLeader) return;
        if (members.length >= guild.member_cap) {
            setErrorMsg('Limit graczy gildii został osiągnięty.');
            return;
        }
        setBusyId(req.id);
        setErrorMsg(null);
        try {
            await guildApi.acceptRequest({
                requestId: req.id,
                guildId: guild.id,
                characterId: req.character_id,
                characterName: req.character_name,
                characterClass: req.character_class,
                characterLevel: req.character_level,
                // Transform tier isn't stored on the request row; we
                // default to 0 here and the member's next visit to
                // /guild syncs their actual tier via updateMemberStats.
                characterTransformTier: 0,
            });
            await useGuildStore.getState().refreshMembers();
            await useGuildStore.getState().refreshRequests();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Nie udało się przyjąć członka.');
        } finally {
            setBusyId(null);
        }
    };

    const handleReject = async (req: IGuildJoinRequestRow) => {
        if (!isLeader) return;
        setBusyId(req.id);
        try {
            await guildApi.deleteRequest({ requestId: req.id });
            await useGuildStore.getState().refreshRequests();
        } finally {
            setBusyId(null);
        }
    };

    return (
        <>
            <header className="guild__top-bar">
                <button className="guild__nav-back" onClick={onBack}>← Gildia</button>
                <h2 className="guild__top-title">📜 Prośby o dołączenie</h2>
            </header>
            {errorMsg && <div className="guild__create-error">{errorMsg}</div>}
            <ul className="guild__requests">
                {requests.length === 0 && <li className="guild__list-empty">Brak nowych próśb.</li>}
                {/* 2026-05-18 spec ("guziki na mobilce pod nazwa gracza
                    i guzik przyjmij na zielono, nazwa gracza i guziki
                    wysrodkowane"): each row collapses to a column on
                    narrow viewports — class icon + name + class on top,
                    reject/accept stacked beneath, everything centred.
                    Accept button uses the dedicated "ok" variant for
                    the green hue (instead of the orange primary). */}
                {requests.map((req) => (
                    <li key={req.id} className="guild__request-row">
                        <div className="guild__request-header">
                            <span
                                className="guild__member-class-icon"
                                style={{ color: CLASS_COLORS[req.character_class] }}
                            >
                                {CLASS_ICONS[req.character_class] ?? '?'}
                            </span>
                            <div className="guild__member-info">
                                <div className="guild__member-name">{req.character_name}</div>
                                <div className="guild__member-class" style={{ color: CLASS_COLORS[req.character_class] }}>
                                    {req.character_class} · Lvl {req.character_level}
                                </div>
                            </div>
                        </div>
                        {isLeader ? (
                            <div className="guild__request-actions">
                                <button
                                    className="guild__btn-danger"
                                    disabled={busyId === req.id}
                                    onClick={() => handleReject(req)}
                                >
                                    ✕ Odrzuć
                                </button>
                                <button
                                    className="guild__btn-ok"
                                    disabled={busyId === req.id}
                                    onClick={() => handleAccept(req)}
                                >
                                    ✓ Przyjmij
                                </button>
                            </div>
                        ) : (
                            <span className="guild__list-meta">Czeka na decyzję lidera</span>
                        )}
                    </li>
                ))}
            </ul>
        </>
    );
};

// ═════════════════════════════════════════════════════════════════════════════
// MODAL — local reusable popup. Not extracted to a shared component since
// the project doesn't have one yet — keeping the styling local for now.
// ═════════════════════════════════════════════════════════════════════════════

interface IModalProps {
    onClose: () => void;
    title?: string;
    wide?: boolean;
    children: React.ReactNode;
}

const Modal = ({ onClose, title, wide, children }: IModalProps) => (
    <div className="guild__modal-overlay" onClick={onClose}>
        <div
            className={`guild__modal${wide ? ' guild__modal--wide' : ''}`}
            onClick={(e) => e.stopPropagation()}
        >
            {title && <h3 className="guild__modal-title">{title}</h3>}
            {children}
        </div>
    </div>
);

export default Guild;
