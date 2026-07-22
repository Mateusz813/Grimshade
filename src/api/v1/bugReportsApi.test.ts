import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}));

const getSessionMock = vi.fn();
vi.mock('../../lib/supabase', () => ({
    supabase: { auth: { getSession: () => getSessionMock() } },
}));

import api from './axiosInstance';
import { bugReportsApi, BUG_REPORT_CONTENT_MAX } from './bugReportsApi';

const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });

const withSession = () =>
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });

beforeEach(() => {
    vi.clearAllMocks();
    withSession();
});

describe('bugReportsApi.submitReport', () => {
    it('inserts the report with the session user id and returns the created row', async () => {
        const row = { id: 'b1', user_id: 'user-1', view_key: 'shop', content: 'Cena zła' };
        mockApi.post.mockResolvedValueOnce(mkRes([row]));

        const result = await bugReportsApi.submitReport({
            view_key: 'shop',
            content: 'Cena zła',
            character_id: 'char-1',
            character_name: 'Hero',
        });

        expect(mockApi.post).toHaveBeenCalledTimes(1);
        const [url, payload, config] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/bug_reports');
        expect(payload).toMatchObject({
            user_id: 'user-1',
            view_key: 'shop',
            content: 'Cena zła',
            character_id: 'char-1',
            character_name: 'Hero',
        });
        expect(payload.app_version).toEqual(expect.any(String));
        expect(config.headers).toEqual({ Prefer: 'return=representation' });
        expect(result).toEqual(row);
    });

    it('defaults character fields to null when no character is passed', async () => {
        mockApi.post.mockResolvedValueOnce(mkRes([{ id: 'b2' }]));

        await bugReportsApi.submitReport({ view_key: 'other', content: 'coś nie gra' });

        expect(mockApi.post.mock.calls[0][1]).toMatchObject({
            character_id: null,
            character_name: null,
        });
    });

    it('trims the content and caps it at the column limit', async () => {
        mockApi.post.mockResolvedValueOnce(mkRes([{ id: 'b3' }]));

        await bugReportsApi.submitReport({
            view_key: 'boss',
            content: `   ${'x'.repeat(BUG_REPORT_CONTENT_MAX + 50)}   `,
        });

        const sent = mockApi.post.mock.calls[0][1].content as string;
        expect(sent.length).toBe(BUG_REPORT_CONTENT_MAX);
        expect(sent.startsWith('x')).toBe(true);
    });

    it('returns null without hitting the API when there is no session', async () => {
        getSessionMock.mockResolvedValue({ data: { session: null } });

        const result = await bugReportsApi.submitReport({ view_key: 'town', content: 'bug' });

        expect(result).toBeNull();
        expect(mockApi.post).not.toHaveBeenCalled();
    });

    it('returns null when Supabase responds with an empty representation', async () => {
        mockApi.post.mockResolvedValueOnce(mkRes([]));

        const result = await bugReportsApi.submitReport({ view_key: 'town', content: 'bug' });

        expect(result).toBeNull();
    });

    it('propagates API errors so the caller can show a retry message', async () => {
        mockApi.post.mockRejectedValueOnce(new Error('boom'));

        await expect(
            bugReportsApi.submitReport({ view_key: 'town', content: 'bug' }),
        ).rejects.toThrow('boom');
    });
});
