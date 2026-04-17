import { useNavigate, useLocation } from 'react-router-dom';
import { useCharacterStore } from '../../../stores/characterStore';
import { useChatNotificationsStore } from '../../../stores/chatNotificationsStore';
import './FloatingNav.scss';

/** Pages where the floating nav should NOT appear at all. */
const HIDDEN_PATHS = ['/login', '/register', '/forgot-password', '/character-select', '/create-character'];

const FloatingNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const character = useCharacterStore((s) => s.character);
  const unreadCount = useChatNotificationsStore((s) => s.unreadCount);

  // Don't show on auth / character-select pages or before a character is picked.
  if (!character || HIDDEN_PATHS.includes(location.pathname)) {
    return null;
  }

  const isOnTown = location.pathname === '/';
  const isOnChat = location.pathname === '/chat';

  return (
    <div className="floating-nav">
      {/* Home button – hidden when already on Town. */}
      {!isOnTown && (
        <button
          className="floating-nav__btn floating-nav__btn--home"
          onClick={() => navigate('/')}
          title="Miasto"
          type="button"
        >
          🏠
        </button>
      )}

      {/* Chat button – visible everywhere except the chat page itself. */}
      {!isOnChat && (
        <button
          className="floating-nav__btn floating-nav__btn--chat"
          onClick={() => navigate('/chat')}
          title="Czat"
          type="button"
        >
          💬
          {unreadCount > 0 && (
            <span className="floating-nav__badge">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
};

export default FloatingNav;
