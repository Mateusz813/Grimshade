import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useCharacterStore } from '../../stores/characterStore';
import { usePartyStore } from '../../stores/partyStore';
import {
  MAX_PARTY_SIZE,
  canJoinParty,
  shouldSuggestBot,
  getPartySummary,
  getPartyBuffs,
  hasOptimalComposition,
  getCompositionBonus,
  type IPartyMember,
} from '../../systems/partySystem';
import { partyApi } from '../../api/v1/partyApi';
import Chat from '../../components/ui/Chat/Chat';
import './Party.scss';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CLASS_ICONS: Record<string, string> = {
  Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
  Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

// ── Component ─────────────────────────────────────────────────────────────────

const Party = () => {
  const navigate   = useNavigate();
  const character  = useCharacterStore((s) => s.character);
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
    addBotHelper,
    removeMember,
    subscribePublicFeed,
    subscribeToActiveParty,
  } = usePartyStore();

  // ── Local form state ─────────────────────────────────────────────────────
  const [createOpen, setCreateOpen]         = useState(false);
  const [formName, setFormName]             = useState('');
  const [formDesc, setFormDesc]             = useState('');
  const [formPassword, setFormPassword]     = useState('');
  const [formIsPublic, setFormIsPublic]     = useState(true);

  const [joinPromptFor, setJoinPromptFor]   = useState<string | null>(null);
  const [joinPassword, setJoinPassword]     = useState('');

  const [editDesc, setEditDesc]             = useState('');
  const [editPassword, setEditPassword]     = useState('');
  const [editIsPublic, setEditIsPublic]     = useState(true);
  const [editOpen, setEditOpen]             = useState(false);

  // ── Subscriptions — live browser feed + active party updates ────────────
  useEffect(() => {
    const unsub = subscribePublicFeed();
    return unsub;
  }, [subscribePublicFeed]);

  useEffect(() => {
    if (!party?.id) return;
    const unsub = subscribeToActiveParty();
    return unsub;
  }, [party?.id, subscribeToActiveParty]);

  // Initialize the edit form whenever the party changes
  useEffect(() => {
    if (!party) return;
    setEditDesc(party.description ?? '');
    setEditIsPublic(party.isPublic ?? true);
    setEditPassword('');
  }, [party?.id, party?.description, party?.isPublic]);

  if (!character) {
    return <div className="party"><p className="party__loading">Ładowanie...</p></div>;
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
  const summary  = party ? getPartySummary(party.members) : null;
  const suggestBot = party ? shouldSuggestBot(party.members) : false;
  const emptySlots = party ? MAX_PARTY_SIZE - party.members.length : 0;

  // ── Browser view helpers ─────────────────────────────────────────────────
  const browsable = useMemo(
    () => publicParties.filter((p) => p.members.length < p.max_members),
    [publicParties],
  );

  const resetCreateForm = () => {
    setFormName('');
    setFormDesc('');
    setFormPassword('');
    setFormIsPublic(true);
    setCreateOpen(false);
  };

  const handleCreateSubmit = async () => {
    await createParty(selfAsMember, {
      name:        formName.trim() || `${character.name}'s party`,
      description: formDesc.trim(),
      password:    formPassword.trim() ? formPassword.trim() : null,
      isPublic:    formIsPublic,
    });
    resetCreateForm();
  };

  const handleJoinClick = (partyId: string, hasPassword: boolean) => {
    if (hasPassword) {
      setJoinPromptFor(partyId);
      setJoinPassword('');
      return;
    }
    void joinPartyById(partyId, selfAsMember);
  };

  const submitJoinWithPassword = async () => {
    if (!joinPromptFor) return;
    await joinPartyById(joinPromptFor, selfAsMember, joinPassword);
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

  return (
    <div className="party">
      <header className="party__header">
        <button className="party__back" onClick={() => navigate('/')}>← Miasto</button>
        <h1 className="party__title">Party</h1>
        {party && (
          <span className="party__size">{party.members.length}/{party.maxMembers ?? MAX_PARTY_SIZE}</span>
        )}
      </header>

      <div className="party__content">
        {error && <p className="party__join-error">{error}</p>}
        {loading && <p className="party__loading">Synchronizuję...</p>}

        {/* ── No party: browser + create ────────────────────────────────────── */}
        {!party && (
          <>
            <div className="party__no-party">
              <p className="party__no-party-msg">
                Nie jesteś w żadnym party. Przeglądaj otwarte drużyny lub załóż swoją.
              </p>
              {!createOpen && (
                <button className="party__create-btn" onClick={() => setCreateOpen(true)}>
                  + Stwórz nowe party
                </button>
              )}
            </div>

            {/* Create form */}
            <AnimatePresence>
              {createOpen && (
                <motion.div
                  className="party__create-form"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <label className="party__field">
                    <span>Nazwa</span>
                    <input
                      value={formName}
                      maxLength={40}
                      placeholder={`${character.name}'s party`}
                      onChange={(e) => setFormName(e.target.value)}
                    />
                  </label>
                  <label className="party__field">
                    <span>Opis (np. "szukam tanka")</span>
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
                  <label className="party__field party__field--checkbox">
                    <input
                      type="checkbox"
                      checked={formIsPublic}
                      onChange={(e) => setFormIsPublic(e.target.checked)}
                    />
                    <span>Widoczne w przeglądarce party</span>
                  </label>
                  <div className="party__form-actions">
                    <button className="party__create-btn" onClick={handleCreateSubmit} disabled={loading}>
                      Utwórz
                    </button>
                    <button className="party__leave-btn" onClick={resetCreateForm}>
                      Anuluj
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Public browser feed */}
            <h3 className="party__section-title">Otwarte drużyny ({browsable.length})</h3>
            {browsable.length === 0 && (
              <p className="party__no-buffs">Brak otwartych party. Załóż własne!</p>
            )}
            <div className="party__browser">
              {browsable.map((p) => {
                const isPromptOpen = joinPromptFor === p.id;
                return (
                  <div key={p.id} className="party__browser-row">
                    <div className="party__browser-main">
                      <span className="party__browser-name">
                        {p.has_password ? '🔒 ' : ''}{p.name || 'Party'}
                      </span>
                      {p.description && (
                        <span className="party__browser-desc">"{p.description}"</span>
                      )}
                      <span className="party__browser-meta">
                        {p.members.length}/{p.max_members} • Avg lvl{' '}
                        {p.members.length
                          ? Math.floor(p.members.reduce((s, m) => s + m.character_level, 0) / p.members.length)
                          : 0}
                      </span>
                      <span className="party__browser-classes">
                        {p.members.map((m) => CLASS_ICONS[m.character_class] ?? '?').join(' ')}
                      </span>
                    </div>
                    {!isPromptOpen && (
                      <button
                        className="party__join-btn"
                        disabled={loading}
                        onClick={() => handleJoinClick(p.id, p.has_password)}
                      >
                        Dołącz
                      </button>
                    )}
                    {isPromptOpen && (
                      <div className="party__join-row">
                        <input
                          className="party__join-input"
                          type="text"
                          value={joinPassword}
                          placeholder="Hasło"
                          autoFocus
                          onChange={(e) => setJoinPassword(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void submitJoinWithPassword(); }}
                        />
                        <button className="party__join-btn" onClick={submitJoinWithPassword}>OK</button>
                        <button
                          className="party__leave-btn"
                          onClick={() => { setJoinPromptFor(null); setJoinPassword(''); }}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── In party ────────────────────────────────────────────────── */}
        {party && (
          <>
            {/* Party meta */}
            <div className="party__id-row">
              <span className="party__id-label">Party:</span>
              <span className="party__id-code">{party.name ?? party.id}</span>
              {party.hasPassword && <span className="party__size">🔒</span>}
            </div>
            {party.description && (
              <p className="party__no-party-msg">"{party.description}"</p>
            )}

            {/* Leader edit button */}
            {isLeader && !editOpen && (
              <button className="party__bot-btn-alt" onClick={() => setEditOpen(true)}>
                ✎ Edytuj party
              </button>
            )}
            <AnimatePresence>
              {editOpen && isLeader && (
                <motion.div
                  className="party__create-form"
                  initial={{ opacity: 0, y: -10 }}
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
                    <button className="party__create-btn" onClick={submitEdit}>Zapisz</button>
                    <button className="party__leave-btn" onClick={() => setEditOpen(false)}>
                      Anuluj
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Stats summary */}
            {summary && (
              <div className="party__summary">
                <div className="party__summary-item">
                  <span className="party__summary-label">Drop ×</span>
                  <span className="party__summary-value">{summary.dropMultiplier.toFixed(2)}</span>
                </div>
                <div className="party__summary-item">
                  <span className="party__summary-label">Trudność ×</span>
                  <span className="party__summary-value">{summary.difficultyMultiplier.toFixed(2)}</span>
                </div>
                <div className="party__summary-item">
                  <span className="party__summary-label">Śr. poziom</span>
                  <span className="party__summary-value">{summary.avgLevel}</span>
                </div>
              </div>
            )}

            {/* Bot suggestion */}
            {suggestBot && canJoinParty(party.members.length) && (
              <div className="party__bot-suggest">
                <span>Brakuje graczy do bossa?</span>
                <button className="party__bot-btn" onClick={addBotHelper}>
                  + Dodaj Bota Pomocnika
                </button>
              </div>
            )}

            {/* Members grid */}
            <div className="party__grid">
              {party.members.map((member) => {
                const hpPct = member.maxHp > 0 ? Math.min(1, member.hp / member.maxHp) : 0;
                const isMe  = member.id === character.id;

                return (
                  <motion.div
                    key={member.id}
                    className={`party__member${isMe ? ' party__member--me' : ''}${member.isBot ? ' party__member--bot' : ''}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                  >
                    <div className="party__member-top">
                      <span className="party__member-icon">
                        {member.isBot ? '🤖' : (CLASS_ICONS[member.class] ?? '?')}
                      </span>
                      <div className="party__member-info">
                        <span className="party__member-name">{member.name}</span>
                        <span className="party__member-class">{member.class} Lvl {member.level}</span>
                      </div>
                      {isMe && <span className="party__me-badge">Ty</span>}
                      {member.isBot && <span className="party__bot-badge">Bot</span>}
                      {isLeader && !isMe && !member.isBot && (
                        <button
                          className="party__kick-btn"
                          onClick={() => {
                            // Leader kick: delete the target character's
                            // party_members row directly. The Realtime
                            // subscription then pushes the updated roster
                            // to everyone else automatically.
                            void partyApi.leaveParty(party.id, member.id);
                          }}
                          title="Wyrzuć"
                        >
                          ✕
                        </button>
                      )}
                      {isLeader && member.isBot && (
                        <button
                          className="party__kick-btn"
                          onClick={() => removeMember(member.id)}
                          title="Wyrzuć bota"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="party__hp-bar-wrap">
                      <div className="party__hp-bar">
                        <div className="party__hp-fill" style={{ width: `${hpPct * 100}%` }} />
                      </div>
                      <span className="party__hp-val">{member.hp}/{member.maxHp}</span>
                    </div>
                  </motion.div>
                );
              })}

              {/* Empty slots */}
              {Array.from({ length: emptySlots }, (_, i) => (
                <div key={`empty_${i}`} className="party__member party__member--empty">
                  <span className="party__empty-label">— wolne miejsce —</span>
                </div>
              ))}
            </div>

            {/* Party Buffs */}
            {party.members.length > 1 && (
              <div className="party__buffs">
                <h3 className="party__section-title">Buffy Druzyny</h3>
                {getPartyBuffs(party.members.map((m) => m.class)).length > 0 ? (
                  getPartyBuffs(party.members.map((m) => m.class)).map((buff) => (
                    <div key={buff.id} className="party__buff">
                      <span className="party__buff-name">{buff.name}</span>
                      <span className="party__buff-effect">
                        {buff.effect === 'heal' ? `+${buff.value * 100}% HP/tura` :
                         buff.effect === 'atk_boost' ? `+${buff.value * 100}% ATK` :
                         buff.effect === 'def_boost' ? `+${buff.value * 100}% DEF` :
                         `+${buff.value * 100}% Speed`}
                      </span>
                      <span className="party__buff-source">({buff.sourceClass})</span>
                    </div>
                  ))
                ) : (
                  <span className="party__no-buffs">Brak aktywnych buffow klasowych</span>
                )}
                {hasOptimalComposition(party.members.map((m) => m.class)) && (
                  <div className="party__comp-bonus">
                    Bonus za roznorodnosc: +{Math.round((getCompositionBonus(party.members.map((m) => m.class)) - 1) * 100)}% XP/Gold
                  </div>
                )}
              </div>
            )}

            {/* Add bot if slots available and no suggestion shown yet */}
            {!suggestBot && canJoinParty(party.members.length) && (
              <button className="party__bot-btn-alt" onClick={addBotHelper}>
                + Dodaj Bota Pomocnika
              </button>
            )}

            {/* Actions */}
            <div className="party__actions">
              {isLeader ? (
                <button className="party__disband-btn" onClick={() => void disbandParty(character.id)}>
                  Rozwiąż party
                </button>
              ) : (
                <button className="party__leave-btn" onClick={() => void leaveParty(character.id)}>
                  Opuść party
                </button>
              )}
            </div>

            {/* Party chat */}
            <Chat
              channel={`party_${party.id}`}
              characterName={character.name}
              characterClass={character.class}
              characterLevel={character.level}
              title={`Chat party (${party.name ?? party.id})`}
              maxHeight={200}
              disableContextMenu
            />
          </>
        )}
      </div>
    </div>
  );
};

export default Party;
