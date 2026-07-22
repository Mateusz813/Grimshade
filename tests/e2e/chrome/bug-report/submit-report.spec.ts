import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { getAdminClient } from '../../fixtures/adminClient';
import { waitForAppReady } from '../../fixtures/appReady';

test.describe('Chrome › Bug report', { tag: '@chrome' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('reports a bug from the AvatarMenu and stores it in the database', async ({ page }) => {
        const admin = getAdminClient();
        const probe = await admin.from('bug_reports').select('id').limit(1);
        const tableMissing = probe.error?.code === '42P01' || probe.error?.code === 'PGRST205';
        test.skip(
            tableMissing,
            'Tabela bug_reports nie istnieje na tej bazie — zastosuj scripts/bug_reports_migration.sql (Supabase SQL Editor).',
        );

        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await waitForAppReady(page);

            await page.getByRole('button', { name: /menu postaci/i }).tap();
            const reportItem = page.getByRole('menuitem', { name: /zgłoś błąd/i });
            await expect(reportItem).toBeVisible({ timeout: 5_000 });
            await reportItem.tap();

            const dialog = page.getByRole('dialog', { name: 'Zgłoś błąd' });
            await expect(dialog).toBeVisible({ timeout: 5_000 });

            const select = dialog.locator('#bug-report-view');
            const textarea = dialog.locator('#bug-report-content');
            const submit = dialog.getByRole('button', { name: 'Wyślij' });

            await expect(select).toHaveValue('');
            await expect(submit).toBeDisabled();

            await select.selectOption('shop');
            await expect(submit).toBeDisabled();

            const content = `E2E bug report ${nick}`;
            await textarea.fill(content);
            await expect(submit).toBeEnabled();

            await submit.tap();
            await expect(dialog.getByRole('status')).toBeVisible({ timeout: 15_000 });

            const { data, error } = await admin
                .from('bug_reports')
                .select('view_key, content, character_id, character_name, status')
                .eq('character_id', createdId)
                .limit(1);

            expect(error).toBeNull();
            expect(data).toHaveLength(1);
            expect(data?.[0]).toMatchObject({
                view_key: 'shop',
                content,
                character_id: createdId,
                character_name: nick,
                status: 'new',
            });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
