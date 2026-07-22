import { supabase } from '../../lib/supabase';
import { BaseApi } from '../BaseApi';
import { APP_VERSION } from '../../lib/appVersion';

export const BUG_REPORT_CONTENT_MAX = 4000;

export interface IBugReport {
    id: string;
    user_id: string;
    character_id: string | null;
    character_name: string | null;
    view_key: string;
    content: string;
    app_version: string | null;
    user_agent: string | null;
    status: string;
    created_at: string;
}

export interface IBugReportInput {
    view_key: string;
    content: string;
    character_id?: string | null;
    character_name?: string | null;
}

interface IBugReportPayload {
    user_id: string;
    character_id: string | null;
    character_name: string | null;
    view_key: string;
    content: string;
    app_version: string;
    user_agent: string;
}

const SUPABASE_RETURN_HEADERS = { headers: { 'Prefer': 'return=representation' } };

class BugReportsApi extends BaseApi {
    submitReport = async (input: IBugReportInput): Promise<IBugReport | null> => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return null;

        const payload: IBugReportPayload = {
            user_id: session.user.id,
            character_id: input.character_id ?? null,
            character_name: input.character_name ?? null,
            view_key: input.view_key,
            content: input.content.trim().slice(0, BUG_REPORT_CONTENT_MAX),
            app_version: APP_VERSION,
            user_agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
        };

        const rows = await this.post<IBugReportPayload, IBugReport[]>({
            url: '/rest/v1/bug_reports',
            data: payload,
            config: SUPABASE_RETURN_HEADERS,
        });
        return rows[0] ?? null;
    };
}

export const bugReportsApi = new BugReportsApi();
