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
import Login from '../views/Auth/Login/Login';
import Register from '../views/Auth/Register/Register';
import ForgotPassword from '../views/Auth/ForgotPassword/ForgotPassword';
import CharacterSelect from '../views/CharacterSelect/CharacterSelect';
import CharacterCreate from '../views/CharacterCreate/CharacterCreate';
import Town from '../views/Town/Town';
import Battle from '../views/Battle/Battle';
import Combat from '../views/Combat/Combat';
import Dungeon from '../views/Dungeon/Dungeon';
import Boss from '../views/Boss/Boss';
import Inventory from '../views/Inventory/Inventory';
import Deposit from '../views/Deposit/Deposit';
// Skills view retired (2026-05 v5) — its content lives inside the
// Postać section's popups (Active Skills + Training popups) so the
// dedicated `/skills` route is no longer needed.
import Leaderboard from '../views/Leaderboard/Leaderboard';
import Shop from '../views/Shop/Shop';
import Party from '../views/Party/Party';
import Tasks from '../views/Tasks/Tasks';
import Quests from '../views/Quests/Quests';
// CharacterStats view retired (2026-05 v6) — stat-point distribution moved
// into the Postać section (/inventory). Combat HUD's "+N statystyk" badge
// also gone in this pass; players see the unspent-points hint on the Postać
// tab and the 4-tile distributor on the /inventory view itself.
import MonsterList from '../views/MonsterList/MonsterList';
import Market from '../views/Market/Market';
import Transform from '../views/Transform/Transform';
import Deaths from '../views/Deaths/Deaths';
import OfflineHunt from '../views/OfflineHunt/OfflineHunt';
import Guild from '../views/Guild/Guild';
import GlobalChat from '../views/GlobalChat/GlobalChat';
import Friends from '../views/Friends/Friends';
import Social from '../views/Social/Social';
import Raid from '../views/Raid/Raid';
import Arena from '../views/Arena/Arena';
import ArenaMatch from '../views/Arena/ArenaMatch';
import Trainer from '../views/Trainer/Trainer';
import BackendTest from '../views/BackendTest/BackendTest';
import OnlineOnlyGuard from './OnlineOnlyGuard';

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

/**
 * Blocks access to dungeon/boss/transform while a live fight is in progress.
 * Offline hunt does NOT block dungeons/bosses/transforms — the hunt keeps
 * rolling kills in the background and the player can jump into a dungeon or
 * boss fight in parallel.
 */
const CombatGuard = ({ children }: { children: React.ReactNode }) => {
    const phase = useCombatStore((s) => s.phase);
    if (phase === 'fighting' || phase === 'victory') {
        return <Navigate to="/" replace />;
    }
    return <>{children}</>;
};

/** Blocks /combat route while an offline hunt is running. */
const HuntGuard = ({ children }: { children: React.ReactNode }) => {
    const huntActive = useOfflineHuntStore((s) => s.isActive);
    if (huntActive) {
        return <Navigate to="/offline-hunt" replace />;
    }
    return <>{children}</>;
};

/** Inner component that lives inside <BrowserRouter> so hooks like useLocation work. */
const AppRouterInner = ({ session }: IAppRouterProps) => {
    const { character } = useCharacterStore();
    useActivityTracker();
    useGlobalChatNotifications();

    return (
        <>
            <DeathNotification />
            <AppShell>
            <Routes>
                {/* Public routes */}
                <Route
                    path="/login"
                    element={!session ? <Login /> : <Navigate to="/" replace />}
                />
                <Route
                    path="/register"
                    element={!session ? <Register /> : <Navigate to="/" replace />}
                />
                <Route path="/forgot-password" element={<ForgotPassword />} />

                {/* Character selection – shown after login if no character selected */}
                <Route
                    path="/character-select"
                    element={
                        <ProtectedRoute session={session}>
                            <CharacterSelect />
                        </ProtectedRoute>
                    }
                />

                {/* Home – redirects based on auth and character state */}
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

                {/* Character creation */}
                <Route
                    path="/create-character"
                    element={
                        <ProtectedRoute session={session}>
                            <CharacterCreate />
                        </ProtectedRoute>
                    }
                />

                {/* Dev: panel testowy backendu (opt-in, izolowany). */}
                <Route
                    path="/backend-test"
                    element={
                        <ProtectedRoute session={session}>
                            <BackendTest />
                        </ProtectedRoute>
                    }
                />

                {/* Game routes – all protected */}
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
                {/* /stats retired — every reference now redirects to /inventory
                    where the Postać view hosts the 4-tile stat-point distributor
                    above the action row. */}
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

                {/* Catch-all */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </AppShell>
            {/* 2026-05-19 v5: floating chat icon lives INSIDE the
                Router so Chat's `useNavigate` works when the popup
                mounts. The badge itself gates on character presence
                so it stays hidden on /login / /character-select. */}
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
