/**
 * Tests for skillApi — get/update/init for character_skills rows.
 */

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

import api from './axiosInstance';
import { skillApi } from './skillApi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('skillApi.getSkills', () => {
    it('queries character_skills filtered by character_id', async () => {
        const rows = [{ id: 's1', character_id: 'c1', skill_id: 'fireball', level: 5 }];
        mockApi.get.mockResolvedValueOnce(mkRes(rows));

        const result = await skillApi.getSkills('c1');

        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toBe('/rest/v1/character_skills?character_id=eq.c1&select=*');
        expect(result).toBe(rows);
    });
});

describe('skillApi.updateSkill', () => {
    it('patches by id and stamps updated_at', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-21T12:00:00.000Z'));
        const updated = { id: 's1', level: 6 };
        mockApi.patch.mockResolvedValueOnce(mkRes([updated]));

        const result = await skillApi.updateSkill('s1', { level: 6 });

        const [url, body, config] = mockApi.patch.mock.calls[0];
        expect(url).toBe('/rest/v1/character_skills?id=eq.s1');
        expect(body.level).toBe(6);
        expect(body.updated_at).toBe('2026-05-21T12:00:00.000Z');
        expect(config.headers.Prefer).toBe('return=representation');
        expect(result).toBe(updated);
        vi.useRealTimers();
    });

    it('overrides updated_at if caller passes one (caller wins)', async () => {
        // The spread `{ ...payload, updated_at: new Date().toISOString() }`
        // means OUR updated_at value always wins, even if the caller sends one.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-21T12:00:00.000Z'));
        mockApi.patch.mockResolvedValueOnce(mkRes([{}]));
        await skillApi.updateSkill('s1', { level: 2, updated_at: '2000-01-01T00:00:00.000Z' });
        const body = mockApi.patch.mock.calls[0][1];
        // Helper's value beats the caller's because it comes second in spread.
        expect(body.updated_at).toBe('2026-05-21T12:00:00.000Z');
        vi.useRealTimers();
    });
});

describe('skillApi.initSkills', () => {
    it('builds an INSERT batch with the right defaults', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-21T12:00:00.000Z'));
        mockApi.post.mockResolvedValueOnce(mkRes([
            { id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }, { id: 's5' },
        ]));

        await skillApi.initSkills('c1', ['fireball', 'iceshard', 'thunder', 'meteor', 'heal']);

        const [url, body, config] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/character_skills');
        expect(config.headers.Prefer).toBe('return=representation');

        // 5 skills built — first 4 are active (slots 0..3), 5th is inactive.
        expect(body).toHaveLength(5);
        for (let i = 0; i < 5; i++) {
            expect(body[i].character_id).toBe('c1');
            expect(body[i].level).toBe(1);
            expect(body[i].xp).toBe(0);
            expect(body[i].xp_to_next).toBe(100);
        }
        // Slot allocation: first 4 are active in slots 0..3, the 5th is inactive.
        expect(body[0]).toMatchObject({ skill_id: 'fireball', is_active: true, slot_index: 0 });
        expect(body[1]).toMatchObject({ skill_id: 'iceshard', is_active: true, slot_index: 1 });
        expect(body[2]).toMatchObject({ skill_id: 'thunder', is_active: true, slot_index: 2 });
        expect(body[3]).toMatchObject({ skill_id: 'meteor', is_active: true, slot_index: 3 });
        expect(body[4]).toMatchObject({ skill_id: 'heal', is_active: false, slot_index: null });

        vi.useRealTimers();
    });

    it('handles fewer than 4 skills (all active, slots assigned in order)', async () => {
        mockApi.post.mockResolvedValueOnce(mkRes([{ id: 's1' }, { id: 's2' }]));
        await skillApi.initSkills('c1', ['fireball', 'iceshard']);
        const body = mockApi.post.mock.calls[0][1];
        expect(body).toHaveLength(2);
        expect(body[0]).toMatchObject({ is_active: true, slot_index: 0 });
        expect(body[1]).toMatchObject({ is_active: true, slot_index: 1 });
    });

    it('handles empty skill list (no-op insert)', async () => {
        mockApi.post.mockResolvedValueOnce(mkRes([]));
        const result = await skillApi.initSkills('c1', []);
        const body = mockApi.post.mock.calls[0][1];
        expect(body).toEqual([]);
        expect(result).toEqual([]);
    });
});

// TODO: no tests cover the auth-token Authorization header — that's
// owned by the axiosInstance interceptor (covered in axiosInstance.test.ts).
