import { test, expect } from '@playwright/test';
import { cleanupTestChatMessages } from '../fixtures/cleanup';

test.describe('Cleanup › Chat', { tag: '@cleanup' }, () => {
    test('wipes leftover E2E chat spam from shared channels', async () => {
        const res = await cleanupTestChatMessages();
        console.log('[wipe-test-chat]', JSON.stringify(res, null, 2));
        expect(res.deleted).toBe(true);
    });
});
