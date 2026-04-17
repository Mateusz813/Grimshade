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
