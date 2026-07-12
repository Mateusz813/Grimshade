
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

import { supabase } from '../../lib/supabase';
import api from './axiosInstance';
import { chatApi } from './chatApi';

const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('chatApi.getMessages', () => {
    it('queries by channel and reverses to chronological order', async () => {
        const rows = [
            { id: '3', content: 'newest' },
            { id: '2', content: 'middle' },
            { id: '1', content: 'oldest' },
        ];
        mockApi.get.mockResolvedValueOnce(mkRes(rows));
        const result = await chatApi.getMessages('global');
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('channel=eq.global');
        expect(url).toContain('order=created_at.desc');
        expect(url).toContain('limit=100');
        expect(result.map((m) => m.id)).toEqual(['1', '2', '3']);
    });

    it('honours a custom limit', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await chatApi.getMessages('global', 25);
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('limit=25');
    });

    it('URL-encodes channel names with special characters', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await chatApi.getMessages('pm_Łysy_Knight');
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain(encodeURIComponent('pm_Łysy_Knight'));
    });
});

describe('chatApi.sendMessage', () => {
    it('returns null and skips the POST when there is no session', async () => {
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: null },
            error: null,
        });
        const result = await chatApi.sendMessage('global', 'hi', 'Knight1', 'Knight', 10);
        expect(mockApi.post).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('inserts a message with truncated content + trimmed whitespace', async () => {
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: { user: { id: 'u1' } } as any },
            error: null,
        });
        const longContent = ' ' + 'a'.repeat(500) + ' ';
        const inserted = { id: 'm1', content: 'a'.repeat(300) };
        mockApi.post.mockResolvedValueOnce(mkRes([inserted]));

        const result = await chatApi.sendMessage('global', longContent, 'Mage1', 'Mage', 7);

        const [url, body, config] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/messages');
        expect(body.channel).toBe('global');
        expect(body.character_name).toBe('Mage1');
        expect(body.character_class).toBe('Mage');
        expect(body.character_level).toBe(7);
        expect(body.user_id).toBe('u1');
        expect(body.content).toBe('a'.repeat(300));
        expect(config.headers.Prefer).toBe('return=representation');
        expect(result).toBe(inserted);
    });

    it('triggers a trim for pm_ channels', async () => {
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: { user: { id: 'u1' } } as any },
            error: null,
        });
        mockApi.post.mockResolvedValueOnce(mkRes([{ id: 'm1' }]));
        mockApi.get.mockResolvedValueOnce(mkRes([]));

        await chatApi.sendMessage('pm_Alice_Bob', 'yo', 'Alice', 'Knight', 5);
        await new Promise((r) => setTimeout(r, 0));
        const trimCalls = mockApi.get.mock.calls.filter((c: unknown[]) =>
            String(c[0]).includes('offset='),
        );
        expect(trimCalls.length).toBeGreaterThan(0);
    });

    it('triggers a trim with the larger 500-cap for guild_ channels', async () => {
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: { user: { id: 'u1' } } as any },
            error: null,
        });
        mockApi.post.mockResolvedValueOnce(mkRes([{ id: 'm1' }]));
        mockApi.get.mockResolvedValueOnce(mkRes([]));

        await chatApi.sendMessage('guild_abc123', 'hello guild', 'Alice', 'Knight', 5);
        await new Promise((r) => setTimeout(r, 0));
        const trimCall = mockApi.get.mock.calls.find((c: unknown[]) =>
            String(c[0]).includes('offset='),
        );
        expect(String(trimCall?.[0])).toContain('offset=500');
    });

    it('does NOT trim the global channel (city log preserved)', async () => {
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: { user: { id: 'u1' } } as any },
            error: null,
        });
        mockApi.post.mockResolvedValueOnce(mkRes([{ id: 'm1' }]));

        await chatApi.sendMessage('global', 'gm', 'Alice', 'Knight', 5);
        await new Promise((r) => setTimeout(r, 0));
        const trimCalls = mockApi.get.mock.calls.filter((c: unknown[]) =>
            String(c[0]).includes('offset='),
        );
        expect(trimCalls.length).toBe(0);
    });

    it('returns null when the insert response is empty', async () => {
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: { user: { id: 'u1' } } as any },
            error: null,
        });
        mockApi.post.mockResolvedValueOnce(mkRes([]));
        const result = await chatApi.sendMessage('global', 'hi', 'A', 'Knight', 1);
        expect(result).toBeNull();
    });
});

describe('chatApi.postSystemEvent', () => {
    it('delegates to sendMessage with channel="system"', async () => {
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: { user: { id: 'u1' } } as any },
            error: null,
        });
        mockApi.post.mockResolvedValueOnce(mkRes([{ id: 'sys-1' }]));
        await chatApi.postSystemEvent('Hero', 'Knight', 100, 'Hero upgraded sword to +20');
        const body = mockApi.post.mock.calls[0][1];
        expect(body.channel).toBe('system');
        expect(body.content).toBe('Hero upgraded sword to +20');
    });
});

describe('chatApi.subscribe', () => {
    it('creates a per-call unique channel filtered by channel=eq.X and returns cleanup', () => {
        const onMock = vi.fn().mockReturnThis();
        const subscribeMock = vi.fn().mockReturnThis();
        const channel = { on: onMock, subscribe: subscribeMock };
        vi.mocked(supabase.channel).mockReturnValueOnce(channel as any);
        (supabase as any).removeChannel = vi.fn();

        const onMessage = vi.fn();
        const cleanup = chatApi.subscribe('global', onMessage);

        const chanName = vi.mocked(supabase.channel).mock.calls[0][0];
        expect(chanName).toContain('chat:global:');

        const onCall = onMock.mock.calls[0];
        expect(onCall[0]).toBe('postgres_changes');
        expect(onCall[1]).toMatchObject({
            event: 'INSERT',
            table: 'messages',
            filter: 'channel=eq.global',
        });
        const payloadCb = onCall[2];
        payloadCb({ new: { id: 'm1', content: 'hi' } });
        expect(onMessage).toHaveBeenCalledWith({ id: 'm1', content: 'hi' });

        cleanup();
        expect((supabase as any).removeChannel).toHaveBeenCalledWith(channel);
    });
});

describe('chatApi.subscribeAll', () => {
    it('subscribes to ALL inserts (no channel filter) and returns cleanup', () => {
        const onMock = vi.fn().mockReturnThis();
        const subscribeMock = vi.fn().mockReturnThis();
        const channel = { on: onMock, subscribe: subscribeMock };
        vi.mocked(supabase.channel).mockReturnValueOnce(channel as any);
        (supabase as any).removeChannel = vi.fn();

        const onMessage = vi.fn();
        const cleanup = chatApi.subscribeAll(onMessage);

        const chanName = vi.mocked(supabase.channel).mock.calls[0][0];
        expect(chanName).toContain('chat:all:');

        const onArgs = onMock.mock.calls[0][1];
        expect(onArgs.filter).toBeUndefined();
        expect(typeof cleanup).toBe('function');
        cleanup();
    });
});

