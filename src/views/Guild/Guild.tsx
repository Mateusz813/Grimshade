import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useTransformStore } from '../../stores/transformStore';
import { useGuildStore } from '../../stores/guildStore';
import { useCombatStore } from '../../stores/combatStore';
import { useOfflineHuntStore } from '../../stores/offlineHuntStore';
import { isBackendMode } from '../../config/backendMode';
import { backendApi } from '../../api/backend/backendApi';
import { syncFromBackend } from '../../api/backend/syncState';
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

interface IBackendGuildCreateResponse {
    guild: IGuildRow;
    gold: number;
}
interface IBackendBossStateResponse {
    boss: IGuildBossStateRow;
    contribution: IGuildBossContributionRow | null;
    contributions: IGuildBossContributionRow[];
    attemptsToday: IGuildBossAttemptRow[];
    weeklyAttempts: IGuildBossAttemptRow[];
}
interface IBackendBossDamageResponse {
    ok: boolean;
    damageDealt: number;
    killed: boolean;
    leveledUp: boolean;
    boss: IGuildBossStateRow;
    guild: IGuildRow;
    contributionTotal: number;
}
interface IBackendBossClaimResponse {
    ok: boolean;
    rewards: IRolledReward[];
    gold: number;
    xp: number;
    level: number;
}
interface IBackendTreasuryViewResponse {
    items: IGuildTreasuryItemRow[];
    logs: IGuildTreasuryLogRow[];
}
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
import { getSpeedScaledCooldownMs } from '../../systems/combat';
import Chat from '../../components/ui/Chat/Chat';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import Icon from '../../components/atoms/Icon/Icon';
import EmojiText from '../../components/atoms/Twemoji/EmojiText';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
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

const RARITY_COLORS: Record<TRarity, string> = CANONICAL_RARITY_COLORS;
const RARITY_LABELS: Record<TRarity, string> = CANONICAL_RARITY_LABELS;

type TRarityFilter = 'all' | TRarity;
const RARITY_FILTERS: TRarityFilter[] = ['all', 'common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'];

type TSlotFilter =
    | 'all'
    | 'weapons' | 'jewelry'
    | 'mainHand' | 'offHand' | 'helmet' | 'shoulders'
    | 'armor' | 'gloves' | 'pants' | 'boots'
    | 'necklace' | 'earrings' | 'ring1';

interface ISlotFilterDef { id: TSlotFilter; label: string; icon: string; }

const ICON_HELMET   = getItemFile('helmet-lekki') ?? 'rescue-worker-s-helmet';
const ICON_ARMOR    = getItemFile('armor-lekki') ?? 'safety-vest';
const ICON_PANTS    = getItemFile('legs-lekki') ?? 'jeans';
const ICON_BOOTS    = getItemFile('boots-lekki') ?? 'woman-s-boot';
const ICON_GLOVES   = getItemFile('glove-lekki') ?? 'gloves';
const ICON_SHOULDER = getItemFile('shoulder-lekki') ?? 'military-medal';
const ICON_SWORD    = getItemFile('miecz') ?? 'crossed-swords';
const ICON_SHIELD   = getItemFile('tarcza') ?? 'shield';
const ICON_RING     = getItemFile('ring') ?? 'ring';
const ICON_NECK     = getItemFile('nackle') ?? 'prayer-beads';
const ICON_EARRINGS = getItemFile('earrings') ?? 'sparkles';

const SLOT_FILTERS: ISlotFilterDef[] = [
    { id: 'all',        label: 'Wszystkie',    icon: 'backpack' },
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

const itemMatchesSlotFilter = (itemId: string, filter: TSlotFilter): boolean => {
    if (filter === 'all') return true;
    const slot = getItemSlotSafe(itemId, ALL_ITEMS_FLAT) as TEquipmentSlot | null;
    if (!slot) return false;
    if (filter === 'weapons') return slot === 'mainHand' || slot === 'offHand';
    if (filter === 'jewelry') {
        return slot === 'ring1' || slot === 'ring2' || slot === 'necklace' || slot === 'earrings';
    }
    if (filter === 'ring1') return slot === 'ring1' || slot === 'ring2';
    return slot === filter;
};

type TSortOrder = 'level-desc' | 'level-asc';
const SORT_LABELS: Record<TSortOrder, string> = {
    'level-desc': 'Lvl',
    'level-asc':  'Lvl',
};

const PAGE_SIZE = 10;

const CLASS_ICONS: Record<string, string> = {
    Knight: 'crossed-swords', Mage: 'crystal-ball', Cleric: 'sparkles', Archer: 'bow-and-arrow',
    Rogue: 'dagger', Necromancer: 'skull', Bard: 'musical-note',
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

const Guild = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const guildState = useGuildStore();
    const [screen, setScreen] = useState<ScreenKey>('list');
    const lastCharacterRef = useRef<string | null>(null);

    useEffect(() => {
        if (!character?.id) return;
        if (lastCharacterRef.current === character.id) return;
        lastCharacterRef.current = character.id;
        void guildState.hydrateForCharacter(character.id);
    }, [character?.id]);

    useEffect(() => {
        if (guildState.guild) {
            if (screen === 'list') setScreen('home');
        } else {
            if (screen !== 'list') setScreen('list');
        }
    }, [guildState.guild?.id]);

    if (!character) {
        return (
            <div className="guild">
                <header className="guild__top-bar">
                    <h1 className="guild__top-title"><GameIcon name="classical-building" /> Gildie</h1>
                </header>
                <div className="guild__empty">Zaloguj się, by przeglądać gildie.</div>
            </div>
        );
    }

    return (
        <div className="guild">
            {screen === 'list' && (
                <GuildList
                    onPickGuildToApply={() => { }}
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
            if (isBackendMode()) {
                const res = await backendApi.guildsBrowse({
                    offset: page * PAGE_SIZE,
                    limit: PAGE_SIZE,
                    search,
                }) as {
                    guilds: IGuildRow[];
                    summaries: Record<string, { memberCount: number; leaderName: string | null }>;
                    total: number;
                };
                setRows(res.guilds ?? []);
                setTotal(res.total ?? 0);
                setSummaries(res.summaries ?? {});
                return;
            }
            const [list, count] = await Promise.all([
                guildApi.listGuilds({ offset: page * PAGE_SIZE, limit: PAGE_SIZE, search }),
                guildApi.countGuilds(search),
            ]);
            setRows(list);
            setTotal(count);
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

    useEffect(() => {
        if (guildState.guild) onEnterMine();
    }, [guildState.guild?.id]);

    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const handleApplyConfirm = async () => {
        if (!applyTarget || !character) return;
        setApplyBusy(true);
        try {
            if (isBackendMode()) {
                try {
                    await backendApi.joinGuild(character.id, applyTarget.id);
                    setApplyMsg(`Wysłano prośbę o dołączenie do ${applyTarget.name}.`);
                    setApplyTarget(null);
                } catch (err) {
                    setApplyMsg(err instanceof Error ? err.message : 'Nie udało się wysłać prośby.');
                } finally {
                    setApplyBusy(false);
                }
                return;
            }
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
                <h1 className="guild__top-title"><GameIcon name="classical-building" /> Gildie</h1>
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
                                        <TinyIcon icon={getGuildIcon(g.logo)} />
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
                                        <GameIcon name="handshake" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {pageCount > 1 && (
                    <div className="guild__list-pager">
                        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}><Icon name="arrowLeft" /> Poprzednia</button>
                        <span>Strona {page + 1} / {pageCount}</span>
                        <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>Następna <Icon name="arrowRight" /></button>
                    </div>
                )}
                <div className="guild__list-actions">
                    <button
                        className="guild__list-create"
                        onClick={() => setCreateOpen(true)}
                    >
                        <Icon name="plus" /> Stwórz gildię
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
        if (isBackendMode()) {
            try {
                const res = await backendApi.createGuild(character.id, {
                    name: trimmedName,
                    tag: trimmedTag,
                    logo,
                    color,
                }) as IBackendGuildCreateResponse;
                useGuildStore.getState().setGuild(res.guild);
                await syncFromBackend(character.id);
                onCreated();
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Tworzenie gildii nie powiodło się.');
            } finally {
                setBusy(false);
            }
            return;
        }
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
            await guildApi.purgeRequestsForCharacter(character.id).catch(() => { });
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
                        <GameIcon name={g.icon} />
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
                    <TinyIcon icon={getGuildIcon(logo)} />
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
    const [confirmDisband, setConfirmDisband] = useState(false);

    const [contribMap, setContribMap] = useState<Record<string, number>>({});
    useEffect(() => {
        if (!guild) return;
        const refresh = async () => {
            try {
                if (isBackendMode() && character) {
                    const res = await backendApi.guildBossState(character.id, guild.id) as IBackendBossStateResponse;
                    const out: Record<string, number> = {};
                    for (const r of res.contributions ?? []) out[r.character_id] = r.total_damage;
                    setContribMap(out);
                    return;
                }
                const rows = await guildApi.listContributions({
                    guildId: guild.id,
                    weekStart: getCurrentWeekStartIso(),
                });
                const out: Record<string, number> = {};
                for (const r of rows) out[r.character_id] = r.total_damage;
                setContribMap(out);
            } catch { }
        };
        void refresh();
        const t = setInterval(refresh, 5000);
        return () => clearInterval(t);
    }, [guild, character]);

    useEffect(() => {
        if (!character || !guild) return;
        const me = members.find((m) => m.character_id === character.id);
        if (!me) return;
        const myTier = useTransformStore.getState().getHighestCompletedTransform?.() ?? 0;
        const stale =
            me.character_level !== character.level
            || me.character_class !== character.class
            || (me.character_transform_tier ?? 0) !== myTier;
        if (stale && !isBackendMode()) {
            void guildApi.updateMemberStats({
                characterId: character.id,
                level: character.level,
                characterClass: character.class,
                transformTier: myTier,
            }).catch(() => { });
        }
    }, [character, guild, members]);

    const handleKickConfirm = async () => {
        if (!confirmKick) return;
        if (isBackendMode() && character) {
            try {
                await backendApi.kickGuildMember(character.id, guild.id, confirmKick.character_id);
                await useGuildStore.getState().hydrateForCharacter(character.id);
            } catch { }
            setConfirmKick(null);
            return;
        }
        await guildApi.kickMember({ guildId: guild.id, characterId: confirmKick.character_id });
        setConfirmKick(null);
    };

    const handleLeaveConfirm = async () => {
        if (!character) return;
        if (isBackendMode()) {
            try {
                await backendApi.leaveGuild(character.id, guild.id);
            } catch { }
            useGuildStore.getState().clear();
            useGuildStore.setState((s) => ({
                guildIdByCharacter: { ...s.guildIdByCharacter, [character.id]: null },
            }));
            setConfirmLeave(false);
            return;
        }
        const { disbanded } = await guildApi.leaveGuild({ guildId: guild.id, characterId: character.id });
        void disbanded;
        useGuildStore.getState().clear();
        await useGuildStore.getState().hydrateForCharacter(character.id);
        setConfirmLeave(false);
    };

    const handleDisbandConfirm = async () => {
        if (!character) return;
        if (isBackendMode()) {
            try {
                await backendApi.disbandGuild(character.id, guild.id);
            } catch { }
            useGuildStore.getState().clear();
            useGuildStore.setState((s) => ({
                guildIdByCharacter: { ...s.guildIdByCharacter, [character.id]: null },
            }));
            setConfirmDisband(false);
            return;
        }
        await guildApi.disbandGuild(guild.id);
        useGuildStore.getState().clear();
        await useGuildStore.getState().hydrateForCharacter(character.id);
        setConfirmDisband(false);
    };

    const xpToNext = guildXpToNextLevel(guild.level);
    const xpPct = xpToNext > 0 && xpToNext !== Infinity
        ? Math.min(1, guild.xp / xpToNext)
        : 1;

    void onBack;

    return (
        <>
            <div className="guild__home-banner">
                <span
                    className="guild__list-logo guild__list-logo--big"
                    style={{ background: guild.color }}
                >
                    <TinyIcon icon={getGuildIcon(guild.logo)} />
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
                        onDisband={() => setConfirmDisband(true)}
                    />
                ))}
            </ul>

            {character && (
                <div className="guild__chat">
                    <Chat
                        channel={`guild_${guild.id}`}
                        characterName={character.name}
                        characterClass={character.class}
                        characterLevel={character.level}
                        title=":speech-balloon: Chat gildii"
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
            {confirmDisband && (
                <Modal onClose={() => setConfirmDisband(false)} title="Rozwiąż gildię">
                    <p>
                        Czy na pewno chcesz <strong>rozwiązać</strong> gildię <strong>{guild.name}</strong>?
                        Wszyscy członkowie ({members.length}) zostaną usunięci, a gildii nie da się odzyskać.
                    </p>
                    <div className="guild__modal-actions">
                        <button onClick={() => setConfirmDisband(false)}>Anuluj</button>
                        <button className="guild__btn-danger" onClick={handleDisbandConfirm}>Rozwiąż gildię</button>
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
    onDisband: () => void;
}

const MemberRow = ({ member, isLeader, isMe, showKick, bossContribution, onKick, onLeave, onDisband }: IMemberRowProps) => {
    const character = useCharacterStore((s) => s.character);
    let avatarUrl: string | null;
    let transformCss: string | null = null;
    if (isMe && character) {
        const completed = useTransformStore.getState().completedTransforms ?? [];
        avatarUrl = getCharacterAvatar(member.character_class, completed);
        const tColor = useTransformStore.getState().getHighestTransformColor();
        transformCss = tColor?.css ?? null;
    } else {
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
                        <GameIcon name={CLASS_ICONS[member.character_class] ?? '?'} />
                    </span>
                )}
            </span>
            <span className="guild__member-class-icon">
                <GameIcon name={CLASS_ICONS[member.character_class] ?? '?'} />
            </span>
            <div className="guild__member-info">
                <div className="guild__member-name">
                    {isLeader && <span className="guild__member-crown" title="Lider gildii"><GameIcon name="crown" /></span>}
                    {member.character_name}
                    {isMe && <span className="guild__member-self">Ty</span>}
                </div>
                <div className="guild__member-class" style={{ color: CLASS_COLORS[member.character_class] }}>
                    {member.character_class} · Lvl {member.character_level}
                </div>
            </div>
            <div className="guild__member-actions">
                <span
                    className="guild__member-contrib"
                    title="XP wniesione do gildii z bossa w tym tygodniu"
                >
                    <GameIcon name="high-voltage" /> {bossContribution.toLocaleString('pl-PL')} XP
                </span>
                {showKick && (
                    <button className="guild__member-kick" onClick={onKick} title="Wyrzuć z gildii">
                        <Icon name="x" />
                    </button>
                )}
                {isMe && (
                    <button className="guild__member-leave" onClick={onLeave} title="Opuść gildię">
                        <GameIcon name="door" />
                    </button>
                )}
                {isMe && isLeader && (
                    <button className="guild__member-leave guild__btn-danger" onClick={onDisband} title="Rozwiąż gildię">
                        <GameIcon name="wastebasket" />
                    </button>
                )}
            </div>
        </li>
    );
};


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
    const floatIdRef = useRef(0);
    const isSunday = isGuildBossClaimDay();
    const [phase, setPhase] = useState<'arena' | 'entry' | 'fighting'>('arena');
    const [engagementDmg, setEngagementDmg] = useState(0);
    const [bossHitPulse, setBossHitPulse] = useState(0);
    const [speedMult, setSpeedMult] = useState<1 | 2 | 4>(1);
    const engagementDmgRef = useRef(0);
    const pendingBossDmgRef = useRef(0);
    const liveBossHpRef = useRef(0);
    const backendDamageRef = useRef<IBackendBossDamageResponse | null>(null);
    const backendTargetHpRef = useRef<number | null>(null);
    const [playerHp, setPlayerHp] = useState(0);
    const [playerMaxHp, setPlayerMaxHp] = useState(0);
    const [playerMp, setPlayerMp] = useState(0);
    const [playerMaxMp, setPlayerMaxMp] = useState(0);
    const [playerHitPulse, setPlayerHitPulse] = useState(0);
    const [, setBossCastFx] = useState<{ id: number; spell: IGuildBossSpell } | null>(null);
    const fx = useCombatFx();
    const [bossAttackingPulse, setBossAttackingPulse] = useState<string | null>(null);
    const playerHpRef = useRef(0);
    const playerMpRef = useRef(0);
    const playerMaxMpRef = useRef(0);
    const skillCooldownsRef = useRef<Record<string, number>>({});
    const lastSkillCastRef = useRef(0);

    const refresh = useCallback(async () => {
        if (!guild || !character) return;
        if (isBackendMode()) {
            try {
                const res = await backendApi.guildBossState(character.id, guild.id) as IBackendBossStateResponse;
                setBoss(res.boss);
                liveBossHpRef.current = res.boss.boss_current_hp;
                setContribution(res.contribution);
                setContributions(res.contributions ?? []);
                setAttempts(res.weeklyAttempts ?? []);
                setAttemptedToday((res.attemptsToday ?? []).length > 0);
            } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : 'Nie udało się załadować bossa.');
            }
            return;
        }
        try {
            let bossRow = await guildApi.fetchOrCreateWeeklyBoss({
                guildId: guild.id,
                bossTier: clampGuildBossTier(guild.boss_tier),
            });
            if (bossRow.current_attacker_id) {
                const ageMs = Date.now() - new Date(bossRow.updated_at).getTime();
                if (ageMs > 60_000) {
                    await guildApi.releaseBossArena({
                        guildId: guild.id,
                        weekStart: bossRow.week_start,
                    }).catch(() => { });
                    bossRow = await guildApi.fetchOrCreateWeeklyBoss({
                        guildId: guild.id,
                        bossTier: clampGuildBossTier(guild.boss_tier),
                    });
                }
            }
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
            setBoss(bossRow);
            liveBossHpRef.current = bossRow.boss_current_hp;
            setContribution(contrib);
            setContributions(all);
            setAttempts(weeklyAtt);
            setAttemptedToday(todayAtt.length > 0);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Nie udało się załadować bossa.');
        }
    }, [guild, character]);

    useEffect(() => { void refresh(); }, [refresh]);

    useEffect(() => {
        const t = setInterval(() => { void refresh(); }, 4000);
        return () => clearInterval(t);
    }, [refresh]);

    useEffect(() => {
        return () => {
            if (isBackendMode()) return;
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
                    }).catch(() => { });
                }
            }).catch(() => { });
        };
    }, []);

    const startEngagement = async () => {
        if (!canAttackToday || busy || !character || !boss) return;
        if (useOfflineHuntStore.getState().isActive) {
            setErrorMsg('Nie mozesz walczyc z bossem gildii podczas polowania offline. Odbierz lub zakoncz polowanie.');
            return;
        }
        const cs = useCombatStore.getState();
        if (cs.phase !== 'idle' || cs.backgroundActive) {
            setErrorMsg('Nie mozesz walczyc z bossem gildii w trakcie walki. Zakoncz polowanie.');
            return;
        }
        if (someoneElseHolds) {
            setErrorMsg('Ktoś inny aktualnie walczy. Poczekaj aż boss straci 10% HP.');
            return;
        }
        setBusy(true);
        setErrorMsg(null);
        try {
            if (isBackendMode()) {
                const res = await backendApi.guildBossDamage(character.id, guild.id) as IBackendBossDamageResponse;
                backendDamageRef.current = res;
                backendTargetHpRef.current = res.boss.boss_current_hp;
            } else if (!youHoldArena) {
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
            skillCooldownsRef.current = {};
            lastSkillCastRef.current = 0;
            setBossCastFx(null);
            fx.resetFx();
            setPhase('entry');
            window.setTimeout(() => {
                setPhase('fighting');
            }, 1700);
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Atak się nie udał.');
        } finally {
            setBusy(false);
        }
    };

    const flushPendingBossDamage = useCallback(async () => {
        const guildId = guild?.id;
        const weekStart = boss?.week_start;
        const characterId = character?.id;
        const characterName = character?.name;
        if (isBackendMode() || !guildId || !weekStart || !characterId || !characterName) return;
        const dmg = pendingBossDmgRef.current;
        if (dmg > 0) {
            pendingBossDmgRef.current = 0;
            try {
                await guildApi.applyBossDamage({ guildId, weekStart, damage: dmg });
            } catch { }
        }
        if (engagementDmgRef.current > 0) {
            try {
                await guildApi.logAttempt({
                    guildId,
                    characterId,
                    characterName,
                    damageDealt: engagementDmgRef.current,
                });
            } catch (err: unknown) {
                console.warn('[guildBoss] logAttempt failed:', err);
            }
        }
    }, [guild?.id, boss?.week_start, character?.id, character?.name]);

    useEffect(() => {
        if (phase !== 'fighting' || isBackendMode()) return;
        const id = window.setInterval(() => { void flushPendingBossDamage(); }, 2500);
        return () => { window.clearInterval(id); void flushPendingBossDamage(); };
    }, [phase, flushPendingBossDamage]);

    const finishEngagement = useCallback(async () => {
        if (!character || !boss) return;
        if (isBackendMode()) {
            const res = backendDamageRef.current;
            if (res) {
                liveBossHpRef.current = res.boss.boss_current_hp;
                setBoss(res.boss);
            }
            backendDamageRef.current = null;
            backendTargetHpRef.current = null;
            setAttemptedToday(true);
            setPhase('arena');
            try {
                await syncFromBackend(character.id);
            } catch { }
            await refresh();
            return;
        }
        await flushPendingBossDamage();
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
    }, [character, boss, guild, refresh, flushPendingBossDamage]);

    useEffect(() => {
        if (phase !== 'fighting' || !character || !boss) return;
        const tier = clampGuildBossTier(guild.boss_tier);
        const basicInterval = Math.max(120, Math.floor(1500 / speedMult));
        const basicTick = () => {
            const backendFloor = isBackendMode() && backendTargetHpRef.current !== null
                ? backendTargetHpRef.current
                : 0;
            if (liveBossHpRef.current <= backendFloor || playerHpRef.current <= 0) {
                void finishEngagement();
                return;
            }
            const eff = getEffectiveChar(character);
            const charAtk = eff?.attack ?? character.attack ?? 100;
            const rawDmg = computeGuildBossDamage(charAtk, character.level, tier);
            const isCrit = Math.random() < 0.2;
            const dmgVal = Math.max(1, Math.floor(rawDmg * (isCrit ? 1.7 : 1)));
            const cappedDmg = Math.min(dmgVal, liveBossHpRef.current - backendFloor);
            engagementDmgRef.current = Math.min(
                engagementDmgRef.current + cappedDmg,
                boss.boss_max_hp,
            );
            setEngagementDmg(engagementDmgRef.current);
            liveBossHpRef.current = Math.max(backendFloor, liveBossHpRef.current - cappedDmg);
            setBoss((b) => (b ? { ...b, boss_current_hp: liveBossHpRef.current } : b));
            setBossHitPulse((p) => p + 1);
            setBossAttackingPulse(`attack-${character.class}`);
            window.setTimeout(() => setBossAttackingPulse(null), 320);
            fx.pushEnemyFloat(0, cappedDmg, 'basic', { isCrit });
            if (!isBackendMode()) {
                pendingBossDmgRef.current += cappedDmg;
            }
        };
        const id = window.setInterval(basicTick, basicInterval);
        return () => window.clearInterval(id);
    }, [phase, speedMult, character?.id, boss?.id, guild?.id]);

    useEffect(() => {
        if (phase !== 'fighting' || !character || !boss) return;
        const tier = clampGuildBossTier(guild.boss_tier);
        const spellCheckInterval = Math.max(80, Math.floor(600 / speedMult));
        const spellTick = () => {
            const backendFloor = isBackendMode() && backendTargetHpRef.current !== null
                ? backendTargetHpRef.current
                : 0;
            if (liveBossHpRef.current <= backendFloor || playerHpRef.current <= 0) return;
            const eff = getEffectiveChar(character);
            const charAtk = eff?.attack ?? character.attack ?? 100;
            const now = Date.now();
            if (now - lastSkillCastRef.current < getSpeedScaledCooldownMs(1200, speedMult)) return;
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
                const baseDmg = computeGuildBossDamage(charAtk, character.level, tier);
                const skillDmg = Math.max(1, Math.floor(baseDmg * def.damage));
                const cappedDmg = Math.min(skillDmg, liveBossHpRef.current - backendFloor);
                playerMpRef.current = Math.max(0, playerMpRef.current - def.mpCost);
                setPlayerMp(playerMpRef.current);
                skillCooldownsRef.current[def.id] = now + getSpeedScaledCooldownMs(def.cooldown, speedMult);
                lastSkillCastRef.current = now;
                engagementDmgRef.current = Math.min(
                    engagementDmgRef.current + cappedDmg,
                    boss.boss_max_hp,
                );
                setEngagementDmg(engagementDmgRef.current);
                liveBossHpRef.current = Math.max(backendFloor, liveBossHpRef.current - cappedDmg);
                setBoss((b) => (b ? { ...b, boss_current_hp: liveBossHpRef.current } : b));
                setBossHitPulse((p) => p + 1);
                fx.pushEnemyFloat(0, cappedDmg, 'spell', {
                    icon: getSkillIcon(def.id),
                });
                if (!isBackendMode()) {
                    pendingBossDmgRef.current += cappedDmg;
                }
                break;
            }
        };
        const id = window.setInterval(spellTick, spellCheckInterval);
        return () => window.clearInterval(id);
    }, [phase, speedMult, character?.id, boss?.id, guild?.id]);

    useEffect(() => {
        if (phase !== 'fighting' || !character || !boss) return;
        const tier = clampGuildBossTier(boss.boss_tier);
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
                const basicSpell = {
                    id: 'basic',
                    name: 'Cios',
                    kind: 'physical' as const,
                    dmgPctOfPlayerMaxHp: 0.045,
                    color: '#ffffff',
                    icon: 'crossed-swords',
                };
                const dmg = computeBossSpellDamage(basicSpell, tier, maxHp);
                playerHpRef.current = Math.max(0, playerHpRef.current - dmg);
                setPlayerHp(playerHpRef.current);
                setPlayerHitPulse((p) => p + 1);
                fx.pushAllyFloat(0, dmg, 'monster');
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
    }, [phase, speedMult, character?.id, boss?.id]);

    const handleClaim = async () => {
        if (!contribution || contribution.rewards_claimed || !boss) return;
        setBusy(true);
        setErrorMsg(null);
        if (isBackendMode()) {
            try {
                const res = await backendApi.guildBossClaim(character.id, guild.id) as IBackendBossClaimResponse;
                await syncFromBackend(character.id);
                setClaimResult(res.rewards ?? []);
                await refresh();
            } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : 'Nie udało się odebrać nagrody.');
            } finally {
                setBusy(false);
            }
            return;
        }
        try {
            const mult = contributionMultiplier(contribution.total_damage, boss.boss_max_hp);
            const rolled = rollGuildBossRewards({
                tier: guild.boss_tier,
                level: character.level,
                contribution: mult,
            });
            applyRolledRewards(rolled);
            await guildApi.markContributionClaimed({
                contributionId: contribution.id,
                rewardsJson: JSON.stringify(rolled),
            });
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

    if (!boss) {
        return (
            <>
                <header className="guild__top-bar">
                    <button className="guild__nav-back" onClick={onBack}><Icon name="arrowLeft" /> Gildia</button>
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
                <button className="guild__nav-back" onClick={onBack}><Icon name="arrowLeft" /> Gildia</button>
                <h2 className="guild__top-title">
                    Boss gildii · Poziom {renderTier}{renderTier >= GUILD_BOSS_MAX_TIER ? ' (MAX)' : ''}
                </h2>
            </header>

            <div
                className={`guild__boss-stage${phase === 'arena' ? '' : ' is-fighting'}`}
                style={{ backgroundImage: `url("${bgImg}")` }}
            >
                <div className={`guild__boss-card${phase === 'fighting' ? ' is-fighting' : ''}`}>
                    {phase !== 'fighting' ? (
                        <div className="guild__boss-preview">
                            <img
                                src={bossImg}
                                alt={getGuildBossLabel(renderTier)}
                                className="guild__boss-preview-img"
                                draggable={false}
                            />
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
                        const completedTiers = useTransformStore.getState().completedTransforms ?? [];
                        const tColor = useTransformStore.getState().getHighestTransformColor();
                        const accent = tColor?.solid ?? tColor?.gradient?.[0] ?? CLASS_COLORS[character.class] ?? '#888';
                        const bossEnemy: ICombatEnemy = {
                            id: 'guild-boss',
                            name: getGuildBossLabel(renderTier),
                            level: renderTier,
                            sprite: 'dragon',
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

            <div className="guild__boss-controls">
                <div className="guild__boss-name guild__boss-name--ext">
                    {getGuildBossLabel(renderTier)}
                </div>
                {someoneElseHolds && phase === 'arena' && (
                    <div className="guild__boss-banner"><GameIcon name="hourglass-not-done" /> Inny członek walczy. Poczekaj…</div>
                )}
                {isSunday && !boss.boss_killed && (
                    <div className="guild__boss-banner"><GameIcon name="sunrise" /> Niedziela — atakowanie zablokowane.</div>
                )}
                {boss.boss_killed && (
                    <div className="guild__boss-banner guild__boss-banner--win">
                        <GameIcon name="trophy" /> Boss pokonany! Czekaj na niedzielę by odebrać nagrodę.
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
                                {attemptedToday ? 'Atak wykonany dzisiaj' : busy ? 'Wchodzę...' : <><GameIcon name="crossed-swords" /> Atakuj bossa</>}
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
                            {contribution?.rewards_claimed ? 'Odebrano' : busy ? 'Liczenie nagrody…' : <><GameIcon name="wrapped-gift" /> Odbierz nagrody</>}
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

            <div className="guild__boss-log">
                <h3 className="guild__boss-log-title"><GameIcon name="scroll" /> Log ataków (tydzień)</h3>
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
                <Modal onClose={() => setClaimResult(null)} title=":wrapped-gift: Nagrody z bossa" wide>
                    <div className="guild__claim-popup">
                        {claimResult.length === 0 && <p>Pech tej tury — brak nagród.</p>}
                        {claimResult.map((r, i) => (
                            <div key={i} className="guild__claim-line">
                                <span className="guild__claim-icon"><TinyIcon icon={r.icon} /></span>
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


interface IRolledReward { kind: string; label: string; icon: string; }

interface IRollGuildRewardsParams {
    tier: number;
    level: number;
    contribution: number;
}

const rollGuildBossRewards = ({ tier, level, contribution }: IRollGuildRewardsParams): IRolledReward[] => {
    const out: IRolledReward[] = [];
    const goldBase = 1_000_000 * tier * contribution * (1 + level / 50);
    const goldAmount = Math.floor(goldBase * (0.8 + Math.random() * 0.4));
    if (goldAmount > 0) {
        useInventoryStore.getState().addGold(goldAmount);
        out.push({ kind: 'gold', icon: 'money-bag', label: `${formatGoldShort(goldAmount)} golda` });
    }
    const xpAmount = Math.floor(50_000 * tier * contribution * (1 + level / 30));
    if (xpAmount > 0) {
        const guildXpResult = useCharacterStore.getState().addXp(xpAmount);
        out.push({ kind: 'xp', icon: 'star', label: `+${guildXpResult.xpApplied.toLocaleString('pl-PL')} XP` });
    }
    const stones = useInventoryStore.getState();
    const commonStones = Math.max(1, Math.floor(5 * tier * contribution));
    stones.addStones('common_stone', commonStones);
    out.push({ kind: 'stones', icon: 'rock', label: `+${commonStones}× Kamień zwykły` });
    if (Math.random() < Math.min(0.8, 0.3 + tier * 0.05)) {
        const rareStones = Math.max(1, Math.floor(2 * tier * contribution));
        stones.addStones('rare_stone', rareStones);
        out.push({ kind: 'stones', icon: 'gem-stone', label: `+${rareStones}× Kamień rzadki` });
    }
    if (Math.random() < Math.min(0.4, 0.1 + tier * 0.03)) {
        const epicStones = Math.max(1, Math.floor(1 * tier * contribution));
        stones.addStones('epic_stone', epicStones);
        out.push({ kind: 'stones', icon: 'large-blue-diamond', label: `+${epicStones}× Kamień epicki` });
    }
    const potionCount = Math.max(1, Math.floor(3 * contribution));
    stones.addConsumable('hp_potion_small', potionCount);
    stones.addConsumable('mp_potion_small', potionCount);
    out.push({ kind: 'potion', icon: 'test-tube', label: `+${potionCount}× Mała mikstura HP + MP` });
    const itemChance = Math.min(0.95, 0.4 + tier * 0.04);
    if (Math.random() < itemChance) {
        const r = Math.random();
        let rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'heroic' = 'common';
        const heroicChance = Math.min(GUILD_BOSS_HEROIC_MAX_CHANCE, contribution * 0.01);
        if (r < heroicChance) rarity = 'heroic';
        else if (r < 0.05) rarity = 'legendary';
        else if (r < 0.2) rarity = 'epic';
        else if (r < 0.5) rarity = 'rare';
        out.push({ kind: 'item', icon: 'wrapped-gift', label: `Przedmiot ${rarity.toUpperCase()} (lvl ${level})` });
    }
    return out;
};

const applyRolledRewards = (rolled: IRolledReward[]): void => {
    void rolled;
};


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
    const [bagRarity, setBagRarity] = useState<TRarityFilter>('all');
    const [bagSlot, setBagSlot] = useState<TSlotFilter>('all');
    const [bagSort, setBagSort] = useState<TSortOrder>('level-desc');
    const [vaultRarity, setVaultRarity] = useState<TRarityFilter>('all');
    const [vaultSlot, setVaultSlot] = useState<TSlotFilter>('all');
    const [vaultSort, setVaultSort] = useState<TSortOrder>('level-desc');

    const refresh = useCallback(async () => {
        if (!guild) return;
        if (isBackendMode() && character) {
            try {
                const res = await backendApi.guildTreasury(character.id, guild.id) as IBackendTreasuryViewResponse;
                setTreasury(res.items ?? []);
                setLogs(res.logs ?? []);
            } catch { }
            return;
        }
        const [items, allLogs] = await Promise.all([
            guildApi.listTreasury(guild.id),
            guildApi.listTreasuryLogs(guild.id),
        ]);
        setTreasury(items);
        setLogs(allLogs);
    }, [guild, character]);

    const treasuryParsed = useMemo(() => {
        return treasury.map((row) => {
            let parsed: IInventoryItem | null;
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
        if (isBackendMode()) {
            try {
                await backendApi.guildTreasuryDeposit(character.id, guild.id, item.uuid);
                await syncFromBackend(character.id);
                await refresh();
            } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : 'Nie udało się zdeponować.');
            } finally {
                setBusy(false);
            }
            return;
        }
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
        if (isBackendMode()) {
            try {
                await backendApi.guildTreasuryWithdraw(character.id, guild.id, row.id);
                await syncFromBackend(character.id);
                await refresh();
            } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : 'Nie udało się wypłacić.');
            } finally {
                setBusy(false);
            }
            return;
        }
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
                <button className="guild__nav-back" onClick={onBack}><Icon name="arrowLeft" /> Gildia</button>
                <h2 className="guild__top-title"><GameIcon name="gem-stone" /> Skarbiec gildii</h2>
                <button className="guild__btn-secondary" onClick={() => setShowLogs(true)}>
                    <GameIcon name="scroll" /> Logi
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
                                    <ItemIcon
                                        icon={info?.icon ?? 'package'}
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
                                        Włóż <Icon name="arrowRight" />
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
                                        icon={info?.icon ?? 'package'}
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
                                        <Icon name="arrowLeft" /> Wyciągnij
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
                <Modal onClose={() => setShowLogs(false)} title=":scroll: Historia skarbca" wide>
                    <ul className="guild__log-list">
                        {logs.length === 0 && <li>Brak operacji.</li>}
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
                        <span className="guild__treasury-filter-icon-emoji"><GameIcon name={s.icon} /></span>
                    )}
                    <span className="guild__treasury-filter-label">{s.label}</span>
                </button>
            ))}
        </div>
        <div className="guild__treasury-filter-row">
            <button
                className={`guild__treasury-filter-pill${sort === 'level-desc' ? ' is-active' : ''}`}
                onClick={() => onSort('level-desc')}
            >
                {SORT_LABELS['level-desc']} <Icon name="arrowDown" />
            </button>
            <button
                className={`guild__treasury-filter-pill${sort === 'level-asc' ? ' is-active' : ''}`}
                onClick={() => onSort('level-asc')}
            >
                {SORT_LABELS['level-asc']} <Icon name="arrowUp" />
            </button>
        </div>
    </div>
);


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
        if (isBackendMode()) {
            try {
                await backendApi.acceptRequest(character.id, guild.id, req.character_id);
                await useGuildStore.getState().hydrateForCharacter(character.id);
            } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : 'Nie udało się przyjąć członka.');
            } finally {
                setBusyId(null);
            }
            return;
        }
        try {
            await guildApi.acceptRequest({
                requestId: req.id,
                guildId: guild.id,
                characterId: req.character_id,
                characterName: req.character_name,
                characterClass: req.character_class,
                characterLevel: req.character_level,
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
        if (isBackendMode()) {
            try {
                await backendApi.rejectRequest(character.id, guild.id, req.character_id);
                await useGuildStore.getState().hydrateForCharacter(character.id);
            } finally {
                setBusyId(null);
            }
            return;
        }
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
                <button className="guild__nav-back" onClick={onBack}><Icon name="arrowLeft" /> Gildia</button>
                <h2 className="guild__top-title"><GameIcon name="scroll" /> Prośby o dołączenie</h2>
            </header>
            {errorMsg && <div className="guild__create-error">{errorMsg}</div>}
            <ul className="guild__requests">
                {requests.length === 0 && <li className="guild__list-empty">Brak nowych próśb.</li>}
                {requests.map((req) => (
                    <li key={req.id} className="guild__request-row">
                        <div className="guild__request-header">
                            <span
                                className="guild__member-class-icon"
                                style={{ color: CLASS_COLORS[req.character_class] }}
                            >
                                <GameIcon name={CLASS_ICONS[req.character_class] ?? '?'} />
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
                                    <Icon name="x" /> Odrzuć
                                </button>
                                <button
                                    className="guild__btn-ok"
                                    disabled={busyId === req.id}
                                    onClick={() => handleAccept(req)}
                                >
                                    <GameIcon name="check-mark-button" /> Przyjmij
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
            {title && <h3 className="guild__modal-title"><EmojiText>{title}</EmojiText></h3>}
            {children}
        </div>
    </div>
);

export default Guild;
