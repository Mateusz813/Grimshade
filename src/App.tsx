import { useEffect, useState, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { useCharacterStore, computeBaseStatFloor } from './stores/characterStore';
import { useSkillStore } from './stores/skillStore';
import { useSync } from './hooks/useSync';
import { useMpRegen } from './hooks/useMpRegen';
import { useBackgroundCombat } from './hooks/useBackgroundCombat';
import { useChatUnreadSubscription } from './hooks/useChatUnreadSubscription';
import { useLeaderboardStatSync } from './hooks/useLeaderboardStatSync';
import { useWakeLock } from './hooks/useWakeLock';
import { useSettingsStore } from './stores/settingsStore';
import {
    saveCurrentCharacterStoresSync,
    saveCurrentCharacterStoresForce,
    getActiveCharacterIdForRestore,
    switchToCharacter,
    restoreFromLocalStorageSync,
} from './stores/characterScope';
import { useConnectivityStore } from './stores/connectivityStore';
import { characterApi } from './api/v1/characterApi';
import { markAppReady, markAppRestoring } from './lib/appReady';
import AppRouter from './routes/AppRouter';
import LevelUpNotification from './components/ui/LevelUpNotification/LevelUpNotification';
import Spinner from './components/ui/Spinner/Spinner';
import BackendLoader from './components/ui/BackendLoader/BackendLoader';

const earlyRestoreCharId = getActiveCharacterIdForRestore();
let _earlyRestored = false;
if (earlyRestoreCharId) {
    _earlyRestored = restoreFromLocalStorageSync(earlyRestoreCharId);
}

const App = () => {
    const [session, setSession] = useState<Session | null | undefined>(undefined);
    const { setLoading } = useCharacterStore(useShallow((s) => ({ setLoading: s.setLoading })));
    const [restoring, setRestoring] = useState(true);
    const restoredRef = useRef(false);
    useSync();
    useMpRegen();
    useBackgroundCombat();
    useChatUnreadSubscription();
    useLeaderboardStatSync();
    const keepScreenAwake = useSettingsStore((s) => s.keepScreenAwake);
    useWakeLock(!!session && keepScreenAwake);

    useEffect(() => {
        const handleBeforeUnload = () => saveCurrentCharacterStoresSync();
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    useEffect(() => {
        const sync = () => {
            const ch = useCharacterStore.getState().character;
            if (!ch) return;
            useSkillStore.getState().purgeLockedSkillSlots(ch.class, ch.level);
        };
        sync();
        const unsub = useCharacterStore.subscribe((s, prev) => {
            if (!s.character || !prev.character) return;
            if (s.character.level !== prev.character.level || s.character.class !== prev.character.class) {
                useSkillStore.getState().purgeLockedSkillSlots(s.character.class, s.character.level);
            }
        });
        return unsub;
    }, []);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                saveCurrentCharacterStoresSync();
                if (useConnectivityStore.getState().mode === 'online') {
                    const ch = useCharacterStore.getState().character;
                    const floor = ch ? computeBaseStatFloor(ch.class, ch.highest_level ?? ch.level) : null;
                    const corrupted = !!ch && !!floor && (ch.max_hp < floor.max_hp || ch.max_mp < floor.max_mp);
                    if (ch && !corrupted) {
                        void saveCurrentCharacterStoresForce().catch(() => { });
                    } else if (corrupted) {
                        console.warn('[App] Skipped cloud save — base stats below floor (corrupted), avoiding propagation', { max_hp: ch?.max_hp, max_mp: ch?.max_mp });
                    }
                }
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
            markAppReady();
            return;
        }

        restoredRef.current = true;
        markAppRestoring();

        const restore = async () => {
            try {
                const characters = await characterApi.getCharacters(session.user.id);
                const char = characters.find((c) => c.id === savedCharId);
                if (char) {
                    useCharacterStore.getState().setCharacter(char);
                    await switchToCharacter(savedCharId);
                } else if (_earlyRestored) {
                    await switchToCharacter(savedCharId);
                }
            } catch {
                if (_earlyRestored) {
                    await switchToCharacter(savedCharId);
                }
            } finally {
                setRestoring(false);
                setLoading(false);
                markAppReady();
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
                }}
            >
                <Spinner size="lg" />
            </div>
        );
    }

    return (
      <>
        <AppRouter session={session} />
        <LevelUpNotification />
        <BackendLoader />
      </>
    );
};

export default App;
