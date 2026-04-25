import { useEffect, useState, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { useCharacterStore } from './stores/characterStore';
import { useSync } from './hooks/useSync';
import { useMpRegen } from './hooks/useMpRegen';
import { useBackgroundCombat } from './hooks/useBackgroundCombat';
import { useChatUnreadSubscription } from './hooks/useChatUnreadSubscription';
import {
    saveCurrentCharacterStoresSync,
    getActiveCharacterIdForRestore,
    switchToCharacter,
    restoreFromLocalStorageSync,
} from './stores/characterScope';
import { characterApi } from './api/v1/characterApi';
import AppRouter from './routes/AppRouter';
import LevelUpNotification from './components/ui/LevelUpNotification/LevelUpNotification';
import ChatUnreadBadge from './components/ui/ChatUnreadBadge/ChatUnreadBadge';

/**
 * On module load (before any React render), synchronously restore
 * all 12 gameplay stores from localStorage. This eliminates the race
 * condition where components render with default/empty state while
 * the async Supabase fetch is still in flight.
 *
 * Character stats (level, xp, etc.) are fetched from Supabase separately –
 * this only restores inventory, skills, tasks, mastery, settings, etc.
 */
const earlyRestoreCharId = getActiveCharacterIdForRestore();
let _earlyRestored = false;
if (earlyRestoreCharId) {
    _earlyRestored = restoreFromLocalStorageSync(earlyRestoreCharId);
}

const App = () => {
    const [session, setSession] = useState<Session | null | undefined>(undefined);
    const { setLoading } = useCharacterStore();
    const [restoring, setRestoring] = useState(true);
    const restoredRef = useRef(false);
    useSync();
    useMpRegen();
    useBackgroundCombat();
    useChatUnreadSubscription();

    // Auto-save character stores when closing/refreshing the page
    useEffect(() => {
        const handleBeforeUnload = () => saveCurrentCharacterStoresSync();
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    // Also save on visibilitychange (mobile browsers may not fire beforeunload)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                saveCurrentCharacterStoresSync();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
            setSession(newSession);
            if (!newSession) {
                useCharacterStore.getState().clearCharacter();
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    // Auto-restore character and store data on page refresh
    useEffect(() => {
        if (!session) {
            setRestoring(false);
            return;
        }
        if (restoredRef.current) return;

        const savedCharId = getActiveCharacterIdForRestore();
        if (!savedCharId) {
            setRestoring(false);
            setLoading(false);
            return;
        }

        restoredRef.current = true;

        // Restore character from Supabase and reload all store data
        const restore = async () => {
            try {
                const characters = await characterApi.getCharacters(session.user.id);
                const char = characters.find((c) => c.id === savedCharId);
                if (char) {
                    useCharacterStore.getState().setCharacter(char);
                    // switchToCharacter will restore from localStorage first (sync),
                    // then try Supabase (async) and take the newer version
                    await switchToCharacter(savedCharId);
                } else if (_earlyRestored) {
                    // Character not found in Supabase but we have local data –
                    // still call switchToCharacter to set up auto-save subscriptions
                    await switchToCharacter(savedCharId);
                }
            } catch {
                // Offline or error – if early restore worked, we already have data.
                // Still set up auto-save subscriptions for the locally-restored data.
                if (_earlyRestored) {
                    await switchToCharacter(savedCharId);
                }
            } finally {
                setRestoring(false);
                setLoading(false);
            }
        };
        void restore();
    }, [session, setLoading]);

    if (session === undefined || restoring) {
        return (
            <div
                style={{
                    minHeight: '100vh',
                    background: '#1a1a2e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#9e9e9e',
                }}
            >
                Ładowanie...
            </div>
        );
    }

    return (
      <>
        <AppRouter session={session} />
        <LevelUpNotification />
        <ChatUnreadBadge />
      </>
    );
};

export default App;
