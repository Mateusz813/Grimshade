import { supabase } from '../../lib/supabase';
import { BaseApi } from '../BaseApi';

export interface ILoginPayload {
    email: string;
    password: string;
}

export interface IRegisterPayload {
    email: string;
    password: string;
}

class AuthApi extends BaseApi {
    login = async ({ email, password }: ILoginPayload) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    };

    register = async ({ email, password }: IRegisterPayload) => {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        return data;
    };

    logout = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    };

    resetPassword = async (email: string) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
    };

    /**
     * Change the password of the CURRENTLY signed-in user. Supabase derives
     * the user from the active session token, so no current-password / email
     * is required — only a valid session. Throws the Supabase AuthError on
     * failure (weak password, expired session, …) so callers can surface it.
     */
    updatePassword = async (password: string) => {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
    };

    /**
     * Verify the CURRENT user's password by re-authenticating with the
     * session email + the supplied password. Returns `true` when the password
     * is correct, `false` otherwise (wrong password OR no active session).
     *
     * Used as a security gate before `updatePassword` so a hijacked open
     * session can't silently change the password without knowing the old one.
     * A successful check refreshes the session (same user) — harmless.
     */
    verifyCurrentPassword = async (password: string): Promise<boolean> => {
        const { data } = await supabase.auth.getSession();
        const email = data.session?.user?.email;
        if (!email) return false;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return !error;
    };

    getSession = async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session;
    };

    onAuthStateChange = (callback: (event: string, session: unknown) => void) => {
        return supabase.auth.onAuthStateChange(callback);
    };
}

export const authApi = new AuthApi();
