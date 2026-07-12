import { useMemo } from 'react';
import { useCombatStore } from '../../../stores/combatStore';
import type { IDropDisplay } from '../../../systems/combatEngine';
import { formatGoldShort } from '../../../systems/goldFormat';
import ItemIcon from '../../ui/ItemIcon/ItemIcon';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import { useBuffStore } from '../../../stores/buffStore';
import { usePartyStore } from '../../../stores/partyStore';
import { calculateXpMultiplier, calculateDropMultiplier } from '../../../systems/partySystem';

interface IProps {
    onClose: () => void;
}

interface IGroupedDrop extends IDropDisplay {
    count: number;
    totalSoldPrice: number;
}

const groupDrops = (drops: IDropDisplay[]): IGroupedDrop[] => {
    const map = new Map<string, IGroupedDrop>();
    for (const d of drops) {
        const key = `${d.icon}::${d.name}::${d.rarity}::${d.upgradeLevel ?? 0}::${d.sold ? '1' : '0'}`;
        const existing = map.get(key);
        if (existing) {
            existing.count += 1;
            existing.totalSoldPrice += d.soldPrice ?? 0;
        } else {
            map.set(key, { ...d, count: 1, totalSoldPrice: d.soldPrice ?? 0 });
        }
    }
    return Array.from(map.values());
};

const CombatBackpackModal = ({ onClose }: IProps) => {
    const sessionXp = useCombatStore((s) => s.sessionXpEarned);
    const sessionGold = useCombatStore((s) => s.sessionGoldEarned);
    const sessionKills = useCombatStore((s) => s.sessionKills);
    const drops = useCombatStore((s) => s.sessionDrops);

    const totalKills = Object.values(sessionKills).reduce((sum, n) => sum + n, 0);

    const groupedDrops = useMemo(() => groupDrops(drops), [drops]);

    return (
        <div className="combat-ui__modal-bg" onClick={onClose}>
            <div className="combat-ui__modal" onClick={(e) => e.stopPropagation()}>
                <header className="combat-ui__modal-head">
                    <span className="combat-ui__modal-title"><GameIcon name="backpack" /> Łup tej sesji</span>
                    <button type="button" className="combat-ui__modal-close" onClick={onClose} aria-label="Zamknij">×</button>
                </header>

                {(() => {
                    const party = usePartyStore.getState().party;
                    const partySize = party ? Math.max(1, party.members.length) : 1;
                    const partyXpMult = calculateXpMultiplier(partySize);
                    const partyDropMult = calculateDropMultiplier(partySize);
                    const bStore = useBuffStore.getState();
                    const has100 = bStore.hasBuff('xp_boost_100');
                    const has50 = bStore.hasBuff('xp_boost');
                    const baseXpMult = has100
                        ? bStore.getBuffMultiplier('xp_boost_100')
                        : has50 ? bStore.getBuffMultiplier('xp_boost') : 1;
                    const premiumXpMult = bStore.getBuffMultiplier('premium_xp_boost');
                    const totalXpBonus = partyXpMult * baseXpMult * premiumXpMult - 1;
                    const totalDropBonus = partyDropMult - 1;
                    const xpParts: string[] = [];
                    if (partyXpMult > 1) xpParts.push(`Party +${Math.round((partyXpMult - 1) * 100)}%`);
                    if (has100) xpParts.push('Boost +100%');
                    else if (has50) xpParts.push('Boost +50%');
                    if (premiumXpMult > 1) xpParts.push(`Premium ×${premiumXpMult.toFixed(1)}`);
                    const dropParts: string[] = [];
                    if (partyDropMult > 1) dropParts.push(`Party +${((partyDropMult - 1) * 100).toFixed(1)}%`);
                    if (totalXpBonus <= 0 && totalDropBonus <= 0) return null;
                    return (
                        <div
                            className="combat-ui__modal-bonuses"
                            style={{ marginBottom: 8, fontSize: '0.85em', opacity: 0.85, textAlign: 'center' }}
                        >
                            {totalXpBonus > 0 && (
                                <div>
                                    XP +{Math.round(totalXpBonus * 100)}%
                                    {xpParts.length > 0 && <span style={{ opacity: 0.7 }}> ({xpParts.join(', ')})</span>}
                                </div>
                            )}
                            {totalDropBonus > 0 && (
                                <div>
                                    Drop +{(totalDropBonus * 100).toFixed(1)}%
                                    {dropParts.length > 0 && <span style={{ opacity: 0.7 }}> ({dropParts.join(', ')})</span>}
                                </div>
                            )}
                        </div>
                    );
                })()}
                <div className="combat-ui__modal-totals">
                    <div className="combat-ui__modal-total">
                        <span className="combat-ui__modal-total-label">XP</span>
                        <span className="combat-ui__modal-total-value">+{sessionXp.toLocaleString('pl-PL')}</span>
                    </div>
                    <div className="combat-ui__modal-total">
                        <span className="combat-ui__modal-total-label">Złoto</span>
                        <span className="combat-ui__modal-total-value">+{formatGoldShort(sessionGold)}</span>
                    </div>
                    <div className="combat-ui__modal-total">
                        <span className="combat-ui__modal-total-label">Pokonano</span>
                        <span className="combat-ui__modal-total-value">{totalKills}</span>
                    </div>
                </div>

                {groupedDrops.length > 0 ? (
                    <div className="combat-ui__modal-drops">
                        <h3 className="combat-ui__modal-subtitle">Przedmioty</h3>
                        <div className="combat-ui__modal-drops-grid">
                            {groupedDrops.map((d, i) => {
                                const countLabel = d.count > 1 ? ` ×${d.count}` : '';
                                const tooltip = d.sold
                                    ? `${d.name}${countLabel} · sprzedano za ${formatGoldShort(d.totalSoldPrice)}`
                                    : `${d.name}${countLabel}`;
                                return (
                                    <ItemIcon
                                        key={`${d.icon}-${d.name}-${d.rarity}-${d.upgradeLevel ?? 0}-${d.sold ? 's' : 'k'}-${i}`}
                                        icon={d.icon}
                                        rarity={d.rarity}
                                        upgradeLevel={d.upgradeLevel}
                                        quantity={d.count}
                                        size="md"
                                        tooltip={tooltip}
                                        showTooltip
                                    />
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <p className="combat-ui__modal-empty">Jeszcze nic nie wpadło.</p>
                )}
            </div>
        </div>
    );
};

export default CombatBackpackModal;
