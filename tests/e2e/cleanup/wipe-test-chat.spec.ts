import { test, expect } from '@playwright/test';
import { cleanupTestChatMessages } from '../fixtures/cleanup';

/**
 * Maintenance task (NOT a product test) — one-shot wipe of historical E2E chat
 * spam from the shared channels, leaving characters untouched.
 *
 * Run on demand:  npx playwright test wipe-test-chat
 *
 * New test runs no longer leak chat (per-test cleanup deletes a test's own
 * messages), so this only needs running once to clear spam that predates the
 * chat-cleanup change.
 */
test.describe('Cleanup › Chat', { tag: '@cleanup' }, () => {
    test('wipes leftover E2E chat spam from shared channels', async () => {
        const res = await cleanupTestChatMessages();
        console.log('[wipe-test-chat]', JSON.stringify(res, null, 2));
        expect(res.deleted).toBe(true);
    });
});
