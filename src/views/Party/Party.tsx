import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import {
  MAX_PARTY_SIZE,
  type IPartyMember,
} from '../../systems/partySystem';
import { getCharacterAvatar } from '../../data/classAvatars';
import { useTransformStore } from '../../stores/transformStore';
import Chat from '../../components/ui/Chat/Chat';
import Spinner from '../../components/ui/Spinner/Spinner';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import EmojiText from '../../components/atoms/Twemoji/EmojiText';
import './Party.scss';


const CLASS_ICONS: Record<string, string> = {
  Knight: 'crossed-swords', Mage: 'crystal-ball', Cleric: 'sparkles', Archer: 'bow-and-arrow',
  Rogue: 'dagger', Necromancer: 'skull', Bard: 'musical-note',
};

const CLASS_COLORS: Record<string, string> = {
  Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
  Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};


const Party = () => {
  const character  = useCharacterStore((s) => s.character);
  const completedTransforms = useTransformStore((s) => s.completedTransforms);
  const presenceMap = usePartyPresenceStore((s) => s.byMember);
  const {
    party,
    loading,
    error,
    publicParties,
    createParty,
    joinPartyById,
    leaveParty,
    disbandParty,
    updateMeta,
    transferLeadership,
    subscribePublicFeed,
    refreshPublicParties,
    hydrateActiveParty,
  } = usePartyStore(useShallow((s) => ({ party: s.party, loading: s.loading, error: s.error, publicParties: s.publicParties, createParty: s.createParty, joinPartyById: s.joinPartyById, leaveParty: s.leaveParty, disbandParty: s.disbandParty, updateMeta: s.updateMeta, transferLeadership: s.transferLeadership, subscribePublicFeed: s.subscribePublicFeed, refreshPublicParties: s.refreshPublicParties, hydrateActiveParty: s.hydrateActiveParty })));

  const [createOpen, setCreateOpen]         = useState(false);
  const [formName, setFormName]             = useState('');
  const [formDesc, setFormDesc]             = useState('');
  const [formPassword, setFormPassword]     = useState('');
  const [formIsPublic, setFormIsPublic]     = useState(true);
  const [formMinLevel, setFormMinLevel]     = useState('');

  const [joinPromptFor, setJoinPromptFor]   = useState<{ id: string; name: string } | null>(null);
  const [joinPassword, setJoinPassword]     = useState('');

  const [editDesc, setEditDesc]             = useState('');
  const [editPassword, setEditPassword]     = useState('');
  const [editIsPublic, setEditIsPublic]     = useState(true);
  const [editOpen, setEditOpen]             = useState(false);

  const [transferTarget, setTransferTarget] = useState<IPartyMember | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };
  useEffect(() => {
    if (error) showToast(error);
  }, [error]);

  useEffect(() => {
    if (!character?.id) return;
    void hydrateActiveParty(character.id);
  }, [character?.id, hydrateActiveParty]);

  useEffect(() => {
    if (party?.id) return;
    void refreshPublicParties();
    const unsub = subscribePublicFeed();
    return () => { unsub(); };
  }, [party?.id, subscribePublicFeed, refreshPublicParties]);

  useEffect(() => {
    if (!party) return;
    setEditDesc(party.description ?? '');
    setEditIsPublic(party.isPublic ?? true);
    setEditPassword('');
  }, [party?.id, party?.description, party?.isPublic]);

  const browsable = useMemo(
    () => publicParties.filter((p) => p.members.length < p.max_members),
    [publicParties],
  );

  if (!character) {
    return <div className="party"><Spinner size="lg" /></div>;
  }

  const selfAsMember: IPartyMember = {
    id:       character.id,
    name:     character.name,
    class:    character.class,
    level:    character.level,
    hp:       character.hp,
    maxHp:    character.max_hp,
    isOnline: true,
  };

  const isLeader = party?.leaderId === character.id;

  const resetCreateForm = () => {
    setFormName('');
    setFormDesc('');
    setFormPassword('');
    setFormIsPublic(true);
    setFormMinLevel('');
    setCreateOpen(false);
  };

  const handleCreateSubmit = async () => {
    const parsedMinLevel = formMinLevel.trim() ? parseInt(formMinLevel.trim(), 10) : NaN;
    const minJoinLevel = Number.isFinite(parsedMinLevel) && parsedMinLevel > 1
      ? parsedMinLevel
      : 1;
    await createParty(selfAsMember, {
      name:        formName.trim() || `${character.name}'s party`,
      description: formDesc.trim(),
      password:    formPassword.trim() ? formPassword.trim() : null,
      isPublic:    formIsPublic,
      minJoinLevel,
    });
    resetCreateForm();
  };

  const handleJoinClick = (partyId: string, partyName: string, hasPassword: boolean) => {
    if (hasPassword) {
      setJoinPromptFor({ id: partyId, name: partyName });
      setJoinPassword('');
      return;
    }
    void joinPartyById(partyId, selfAsMember);
  };

  const submitJoinWithPassword = async () => {
    if (!joinPromptFor) return;
    await joinPartyById(joinPromptFor.id, selfAsMember, joinPassword);
    setJoinPromptFor(null);
    setJoinPassword('');
  };

  const submitEdit = async () => {
    await updateMeta({
      description: editDesc.trim(),
      password:    editPassword.trim() ? editPassword.trim() : null,
      isPublic:    editIsPublic,
    });
    setEditOpen(false);
  };

  const confirmTransfer = async () => {
    if (!transferTarget) return;
    await transferLeadership(transferTarget.id);
    setTransferTarget(null);
    showToast(`Lider przekazany: ${transferTarget.name}`);
  };

  return (
    <div className="party">
      <div className="party__content">

        {!party && (
          <>
            <div className="party__intro">
              <h2 className="party__intro-title">Party</h2>
              <p className="party__intro-text">
                Stwórz drużynę albo dołącz do otwartego party. Lider decyduje, dokąd
                rusza cała grupa — gdy klika walkę, każdy potwierdza gotowość i
                zostajecie przeniesieni razem.
              </p>
              {!createOpen && (
                <button className="party__primary-btn" onClick={() => setCreateOpen(true)}>
                  + Stwórz nowe party
                </button>
              )}
            </div>

            <AnimatePresence>
              {createOpen && (
                <motion.div
                  className="party__create-form"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <label className="party__field">
                    <span>Nazwa party</span>
                    <input
                      value={formName}
                      maxLength={40}
                      placeholder={`${character.name}'s party`}
                      onChange={(e) => setFormName(e.target.value)}
                    />
                  </label>
                  <label className="party__field">
                    <span>Opis (np. „szukam tanka na bossa")</span>
                    <input
                      value={formDesc}
                      maxLength={140}
                      placeholder="Co robicie? Kogo szukacie?"
                      onChange={(e) => setFormDesc(e.target.value)}
                    />
                  </label>
                  <label className="party__field">
                    <span>Hasło (puste = publiczne)</span>
                    <input
                      type="text"
                      value={formPassword}
                      maxLength={20}
                      placeholder="bez hasła"
                      onChange={(e) => setFormPassword(e.target.value)}
                    />
                  </label>
                  <label className="party__field">
                    <span>Minimalny poziom (opcjonalnie)</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={9999}
                      value={formMinLevel}
                      placeholder="np. 500 — puste = każdy może dołączyć"
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setFormMinLevel(raw);
                      }}
                    />
                  </label>
                  <label className="party__field party__field--checkbox">
                    <input
                      type="checkbox"
                      checked={formIsPublic}
                      onChange={(e) => setFormIsPublic(e.target.checked)}
                    />
                    <span>Widoczne w przeglądarce party</span>
                  </label>
                  <div className="party__form-actions">
                    <button className="party__primary-btn" onClick={handleCreateSubmit} disabled={loading}>
                      Utwórz
                    </button>
                    <button className="party__secondary-btn" onClick={resetCreateForm}>
                      Anuluj
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="party__section-header">
              <h3 className="party__section-title">Otwarte drużyny ({browsable.length})</h3>
              <button
                className="party__refresh-btn"
                onClick={() => void refreshPublicParties()}
                disabled={loading}
                title="Odśwież listę"
              >
                {loading ? <GameIcon name="hourglass-not-done" /> : <GameIcon name="counterclockwise-arrows-button" />}
              </button>
            </div>

            {browsable.length === 0 ? (
              <p className="party__empty">
                Brak otwartych party. Załóż własne lub kliknij Odśwież.
              </p>
            ) : (
              <div className="party__browser">
                {browsable.map((p) => {
                  const leader = p.members.find((m) => m.character_id === p.leader_id) ?? p.members[0];
                  const leaderClass = leader?.character_class ?? 'Knight';
                  const leaderColor = CLASS_COLORS[leaderClass] ?? '#e94560';
                  const minLevel = p.min_join_level ?? 1;
                  const slotsTotal = p.max_members ?? MAX_PARTY_SIZE;
                  const memberSlots = Array.from({ length: slotsTotal }, (_, i) => p.members[i] ?? null);

                  return (
                    <div key={p.id} className="party__card">
                      <div
                        className="party__card-leader party__card-leader--badge-only"
                        style={{ '--leader-color': leaderColor } as React.CSSProperties}
                      >
                        <span className="party__card-leader-level">Lv {minLevel}</span>
                      </div>

                      <div className="party__card-center">
                        <div className="party__card-name">
                          {p.has_password && <span className="party__card-lock"><GameIcon name="locked" /></span>}
                          {p.name || 'Party'}
                        </div>
                        <div className="party__card-avatars">
                          {memberSlots.map((m, idx) => {
                            if (!m) {
                              return (
                                <span
                                  key={`slot_empty_${idx}`}
                                  className="party__card-avatar party__card-avatar--empty"
                                  aria-label="Wolne miejsce"
                                />
                              );
                            }
                            const cClass = m.character_class;
                            const c = CLASS_COLORS[cClass] ?? '#9e9e9e';
                            return (
                              <span
                                key={m.character_id}
                                className="party__card-avatar"
                                style={{ '--avatar-color': c } as React.CSSProperties}
                                title={`${m.character_name} · ${cClass} Lv ${m.character_level}`}
                              >
                                <GameIcon name={CLASS_ICONS[cClass] ?? '?'} />
                                <span className="party__card-avatar-lvl">{m.character_level}</span>
                              </span>
                            );
                          })}
                        </div>
                        <div className="party__card-desc">
                          {p.description ? `„${p.description}"` : 'Brak opisu'}
                        </div>
                      </div>

                      <div className="party__card-right">
                        <span className="party__card-count">
                          {p.members.length}/{slotsTotal}
                        </span>
                        <button
                          className="party__primary-btn party__primary-btn--small"
                          disabled={
                            loading
                            || p.members.length >= slotsTotal
                            || (character.level < minLevel)
                          }
                          title={
                            character.level < minLevel
                              ? `Wymagany poziom: ${minLevel}+`
                              : undefined
                          }
                          onClick={() => handleJoinClick(p.id, p.name || 'Party', p.has_password)}
                        >
                          Dołącz
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {party && (
          <>
            <div className="party__roster-header">
              <h2 className="party__roster-title">
                {party.hasPassword && <span className="party__card-lock"><GameIcon name="locked" /></span>}
                {party.name ?? 'Party'}
              </h2>
              {party.description && (
                <p className="party__roster-desc">„{party.description}"</p>
              )}
              <div className="party__roster-meta">
                <span>{party.members.length}/{party.maxMembers ?? MAX_PARTY_SIZE} graczy</span>
                {isLeader && (
                  <button
                    type="button"
                    className="party__edit-btn"
                    onClick={() => setEditOpen((v) => !v)}
                  >
                    {editOpen ? 'Schowaj' : <><GameIcon name="pencil" /> Edytuj</>}
                  </button>
                )}
              </div>
            </div>

            <AnimatePresence>
              {editOpen && isLeader && (
                <motion.div
                  className="party__create-form"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <label className="party__field">
                    <span>Opis</span>
                    <input
                      value={editDesc}
                      maxLength={140}
                      onChange={(e) => setEditDesc(e.target.value)}
                    />
                  </label>
                  <label className="party__field">
                    <span>Nowe hasło (puste = brak)</span>
                    <input
                      type="text"
                      value={editPassword}
                      maxLength={20}
                      onChange={(e) => setEditPassword(e.target.value)}
                    />
                  </label>
                  <label className="party__field party__field--checkbox">
                    <input
                      type="checkbox"
                      checked={editIsPublic}
                      onChange={(e) => setEditIsPublic(e.target.checked)}
                    />
                    <span>Widoczne w przeglądarce</span>
                  </label>
                  <div className="party__form-actions">
                    <button className="party__primary-btn" onClick={submitEdit}>Zapisz</button>
                    <button className="party__secondary-btn" onClick={() => setEditOpen(false)}>
                      Anuluj
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <ul className="party__roster">
              {party.members.map((member) => {
                const isMe   = member.id === character.id;
                const isMemberLeader = member.id === party.leaderId;
                const memberColor = CLASS_COLORS[member.class] ?? '#9e9e9e';
                const presence = presenceMap[member.id];
                const tierIds = isMe
                    ? completedTransforms
                    : (presence?.transformTier ? [presence.transformTier] : []);
                const avatarSrc = getCharacterAvatar(member.class, tierIds);
                return (
                  <motion.li
                    key={member.id}
                    className={`party__roster-row${isMe ? ' party__roster-row--me' : ''}${isMemberLeader ? ' party__roster-row--leader' : ''}`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    style={{ '--member-color': memberColor } as React.CSSProperties}
                  >
                    <div className="party__roster-avatar">
                      {avatarSrc
                        ? <img src={avatarSrc} alt={member.name} />
                        : <span><GameIcon name={CLASS_ICONS[member.class] ?? '?'} /></span>}
                    </div>
                    <div className="party__roster-info">
                      <span className="party__roster-name">
                        <EmojiText>{member.name}</EmojiText>
                        {isMemberLeader && <span className="party__roster-crown" title="Lider"><GameIcon name="crown" /></span>}
                        {isMe && <span className="party__roster-you">(Ty)</span>}
                      </span>
                      <span className="party__roster-class">{member.class} · Lv {member.level}</span>
                    </div>
                    {isLeader && !isMe && (
                      <button
                        className="party__roster-promote"
                        onClick={() => setTransferTarget(member)}
                        title="Przekaż lidera"
                      >
                        Przekaż
                      </button>
                    )}
                  </motion.li>
                );
              })}
            </ul>

            <div className="party__actions">
              {isLeader ? (
                <button className="party__danger-btn" onClick={() => void disbandParty(character.id)}>
                  Rozwiąż party
                </button>
              ) : (
                <button className="party__danger-btn" onClick={() => void leaveParty(character.id)}>
                  Opuść party
                </button>
              )}
            </div>

            <Chat
              channel={`party_${party.id}`}
              characterName={character.name}
              characterClass={character.class}
              characterLevel={character.level}
              title={`Czat party (${party.name ?? party.id})`}
              maxHeight={220}
              disableContextMenu
            />
          </>
        )}
      </div>

      <AnimatePresence>
        {joinPromptFor && (
          <motion.div
            className="party__modal-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => { setJoinPromptFor(null); setJoinPassword(''); }}
          >
            <motion.div
              className="party__modal"
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="party__modal-title"><GameIcon name="locked" /> {joinPromptFor.name}</div>
              <p className="party__modal-text">Party wymaga hasła. Wpisz hasło, by dołączyć.</p>
              <input
                className="party__modal-input"
                type="text"
                autoFocus
                placeholder="Hasło"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitJoinWithPassword(); }}
              />
              <div className="party__modal-actions">
                <button
                  className="party__secondary-btn"
                  onClick={() => { setJoinPromptFor(null); setJoinPassword(''); }}
                >
                  Anuluj
                </button>
                <button
                  className="party__primary-btn"
                  onClick={() => void submitJoinWithPassword()}
                  disabled={loading}
                >
                  Zatwierdź
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {transferTarget && (
          <motion.div
            className="party__modal-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setTransferTarget(null)}
          >
            <motion.div
              className="party__modal"
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="party__modal-title"><GameIcon name="crown" /> Przekaż lidera</div>
              <p className="party__modal-text">
                Czy na pewno chcesz przekazać lidera graczowi <strong>{transferTarget.name}</strong>?
                Stracisz uprawnienia lidera natychmiast.
              </p>
              <div className="party__modal-actions">
                <button className="party__secondary-btn" onClick={() => setTransferTarget(null)}>
                  Anuluj
                </button>
                <button className="party__primary-btn" onClick={() => void confirmTransfer()}>
                  Przekaż
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {toast && (
          <motion.div
            className="party__toast"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Party;
