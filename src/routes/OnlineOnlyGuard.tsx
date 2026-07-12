import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useConnectivityStore } from '../stores/connectivityStore';

interface IProps {
    children: React.ReactNode;
}

const OnlineOnlyGuard = ({ children }: IProps) => {
    const mode = useConnectivityStore((s) => s.mode);
    const location = useLocation();
    const navigate = useNavigate();
    useEffect(() => {
        if (mode === 'offline') {
            console.info('[OnlineOnlyGuard] Blocked', location.pathname, '— offline mode active');
        }
    }, [mode, location.pathname]);
    if (mode === 'offline') {
        return <Navigate to="/" replace state={{ blockedFrom: location.pathname }} />;
    }
    void navigate;
    return <>{children}</>;
};

export default OnlineOnlyGuard;
