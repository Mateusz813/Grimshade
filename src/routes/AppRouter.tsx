import { lazy, Suspense } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { useCharacterStore } from '../stores/characterStore';
import { useCombatStore } from '../stores/combatStore';
import { useOfflineHuntStore } from '../stores/offlineHuntStore';
import { useActivityTracker } from '../hooks/useActivityTracker';
import { useGlobalChatNotifications } from '../hooks/useGlobalChatNotifications';

import AppShell from '../components/layout/AppShell/AppShell';
import DeathNotification from '../components/ui/DeathNotification/DeathNotification';
import ChatUnreadBadge from '../components/ui/ChatUnreadBadge/ChatUnreadBadge';
import Spinner from '../components/ui/Spinner/Spinner';
import OnlineOnlyGuard from './OnlineOnlyGuard';

const Login = lazy(() => import('../views/Auth/Login/Login'));
const Register = lazy(() => import('../views/Auth/Register/Register'));
const ForgotPassword = lazy(() => import('../views/Auth/ForgotPassword/ForgotPassword'));
const CharacterSelect = lazy(() => import('../views/CharacterSelect/CharacterSelect'));
const CharacterCreate = lazy(() => import('../views/CharacterCreate/CharacterCreate'));
const Town = lazy(() => import('../views/Town/Town'));
const Battle = lazy(() => import('../views/Battle/Battle'));
const Combat = lazy(() => import('../views/Combat/Combat'));
const Dungeon = lazy(() => import('../views/Dungeon/Dungeon'));
const Boss = lazy(() => import('../views/Boss/Boss'));
const Inventory = lazy(() => import('../views/Inventory/Inventory'));
const Deposit = lazy(() => import('../views/Deposit/Deposit'));
const Leaderboard = lazy(() => import('../views/Leaderboard/Leaderboard'));
const Shop = lazy(() => import('../views/Shop/Shop'));
const Party = lazy(() => import('../views/Party/Party'));
const Tasks = lazy(() => import('../views/Tasks/Tasks'));
const Quests = lazy(() => import('../views/Quests/Quests'));
const MonsterList = lazy(() => import('../views/MonsterList/MonsterList'));
const Market = lazy(() => import('../views/Market/Market'));
const Transform = lazy(() => import('../views/Transform/Transform'));
const Deaths = lazy(() => import('../views/Deaths/Deaths'));
const OfflineHunt = lazy(() => import('../views/OfflineHunt/OfflineHunt'));
const Guild = lazy(() => import('../views/Guild/Guild'));
const GlobalChat = lazy(() => import('../views/GlobalChat/GlobalChat'));
const Friends = lazy(() => import('../views/Friends/Friends'));
const Social = lazy(() => import('../views/Social/Social'));
const Raid = lazy(() => import('../views/Raid/Raid'));
const Arena = lazy(() => import('../views/Arena/Arena'));
const ArenaMatch = lazy(() => import('../views/Arena/ArenaMatch'));
const Trainer = lazy(() => import('../views/Trainer/Trainer'));

interface IAppRouterProps {
    session: Session | null;
}

interface IProtectedRouteProps {
    session: Session | null;
    children: React.ReactNode;
}

const ProtectedRoute = ({ session, children }: IProtectedRouteProps) => {
    if (!session) {
        return <Navigate to="/login" replace />;
    }
    return <>{children}</>;
};

const CombatGuard = ({ children }: { children: React.ReactNode }) => {
    const phase = useCombatStore((s) => s.phase);
    if (phase === 'fighting' || phase === 'victory') {
        return <Navigate to="/" replace />;
    }
    return <>{children}</>;
};

const HuntGuard = ({ children }: { children: React.ReactNode }) => {
    const huntActive = useOfflineHuntStore((s) => s.isActive);
    if (huntActive) {
        return <Navigate to="/offline-hunt" replace />;
    }
    return <>{children}</>;
};

const AppRouterInner = ({ session }: IAppRouterProps) => {
    const { character } = useCharacterStore(useShallow((s) => ({ character: s.character })));
    useActivityTracker();
    useGlobalChatNotifications();

    return (
        <>
            <DeathNotification />
            <AppShell>
            <Suspense fallback={<Spinner />}>
            <Routes>
                <Route
                    path="/login"
                    element={!session ? <Login /> : <Navigate to="/" replace />}
                />
                <Route
                    path="/register"
                    element={!session ? <Register /> : <Navigate to="/" replace />}
                />
                <Route path="/forgot-password" element={<ForgotPassword />} />

                <Route
                    path="/character-select"
                    element={
                        <ProtectedRoute session={session}>
                            <CharacterSelect />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/"
                    element={
                        !session ? (
                            <Navigate to="/login" replace />
                        ) : character === null ? (
                            <Navigate to="/character-select" replace />
                        ) : (
                            <Town />
                        )
                    }
                />

                <Route
                    path="/create-character"
                    element={
                        <ProtectedRoute session={session}>
                            <CharacterCreate />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/battle"
                    element={
                        <ProtectedRoute session={session}>
                            <Battle />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/combat"
                    element={
                        <ProtectedRoute session={session}>
                            <HuntGuard><Combat /></HuntGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/dungeon"
                    element={
                        <ProtectedRoute session={session}>
                            <CombatGuard><Dungeon /></CombatGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/boss"
                    element={
                        <ProtectedRoute session={session}>
                            <CombatGuard><Boss /></CombatGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/inventory"
                    element={
                        <ProtectedRoute session={session}>
                            <Inventory />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/deposit"
                    element={
                        <ProtectedRoute session={session}>
                            <Deposit />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/leaderboard"
                    element={
                        <ProtectedRoute session={session}>
                            <OnlineOnlyGuard><Leaderboard /></OnlineOnlyGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/shop"
                    element={
                        <ProtectedRoute session={session}>
                            <Shop />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/party"
                    element={
                        <ProtectedRoute session={session}>
                            <OnlineOnlyGuard><Party /></OnlineOnlyGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/tasks"
                    element={
                        <ProtectedRoute session={session}>
                            <Tasks />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/quests"
                    element={
                        <ProtectedRoute session={session}>
                            <Quests />
                        </ProtectedRoute>
                    }
                />
                <Route path="/stats" element={<Navigate to="/inventory" replace />} />
                <Route
                    path="/monsters"
                    element={
                        <ProtectedRoute session={session}>
                            <MonsterList />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/daily-quests"
                    element={<Navigate to="/quests" replace />}
                />
                <Route
                    path="/market"
                    element={
                        <ProtectedRoute session={session}>
                            <OnlineOnlyGuard><Market /></OnlineOnlyGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/transform"
                    element={
                        <ProtectedRoute session={session}>
                            <CombatGuard><Transform /></CombatGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/deaths"
                    element={
                        <ProtectedRoute session={session}>
                            <OnlineOnlyGuard><Deaths /></OnlineOnlyGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/offline-hunt"
                    element={
                        <ProtectedRoute session={session}>
                            <OfflineHunt />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/guild"
                    element={
                        <ProtectedRoute session={session}>
                            <Guild />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/chat"
                    element={
                        <ProtectedRoute session={session}>
                            <OnlineOnlyGuard><GlobalChat /></OnlineOnlyGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/friends"
                    element={
                        <ProtectedRoute session={session}>
                            <OnlineOnlyGuard><Friends /></OnlineOnlyGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/social"
                    element={
                        <ProtectedRoute session={session}>
                            <OnlineOnlyGuard><Social /></OnlineOnlyGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/raid"
                    element={
                        <ProtectedRoute session={session}>
                            <OnlineOnlyGuard><CombatGuard><Raid /></CombatGuard></OnlineOnlyGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/arena"
                    element={
                        <ProtectedRoute session={session}>
                            <OnlineOnlyGuard><Arena /></OnlineOnlyGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/arena/match"
                    element={
                        <ProtectedRoute session={session}>
                            <OnlineOnlyGuard><CombatGuard><ArenaMatch /></CombatGuard></OnlineOnlyGuard>
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/trainer"
                    element={
                        <ProtectedRoute session={session}>
                            <CombatGuard><Trainer /></CombatGuard>
                        </ProtectedRoute>
                    }
                />

                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
            </AppShell>
            <ChatUnreadBadge />
        </>
    );
};

const AppRouter = ({ session }: IAppRouterProps) => {
    return (
        <BrowserRouter>
            <AppRouterInner session={session} />
        </BrowserRouter>
    );
};

export default AppRouter;
