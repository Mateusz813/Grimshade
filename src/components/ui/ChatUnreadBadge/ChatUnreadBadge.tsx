import { useChatTabsStore } from '../../../stores/chatTabsStore';
import './ChatUnreadBadge.scss';

/**
 * Floating bottom-right badge that shows the total number of unread private
 * messages across every open PM tab. Clicking jumps to the chat screen, where
 * switching to the relevant tab clears that tab's unread count.
 *
 * Mounted at the App root (outside <Router>), so it uses plain
 * history.pushState + popstate to navigate rather than useNavigate.
 *
 * Only PM tabs contribute — the city tab is excluded, since city chatter
 * shouldn't nag the player while they're off-screen.
 */
const ChatUnreadBadge = () => {
    const total = useChatTabsStore((s) =>
        s.tabs.reduce((sum, t) => sum + (t.type === 'pm' ? t.unread : 0), 0),
    );

    if (total <= 0) return null;

    const goToChat = () => {
        if (window.location.pathname === '/chat') return;
        window.history.pushState({}, '', '/chat');
        // react-router listens to popstate, so dispatch one to sync.
        window.dispatchEvent(new PopStateEvent('popstate'));
    };

    return (
        <button
            type="button"
            className="chat-unread-badge"
            onClick={goToChat}
            title={`${total} nieprzeczytan${total === 1 ? 'a wiadomość' : 'ych wiadomości'}`}
        >
            <span className="chat-unread-badge__icon">💌</span>
            <span className="chat-unread-badge__count">({total > 99 ? '99+' : total})</span>
        </button>
    );
};

export default ChatUnreadBadge;
