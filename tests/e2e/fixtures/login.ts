
import { type Page } from '@playwright/test';
import type { ITestUser } from './testUsers';
import { readSavedAuth } from './authState';

const waitForAuthToken = async (page: Page): Promise<boolean> => {
    return page
        .waitForFunction(
            () => {
                for (let i = 0; i < window.localStorage.length; i++) {
                    const k = window.localStorage.key(i);
                    if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return true;
                }
                return false;
            },
            { timeout: 5_000 },
        )
        .then(() => true)
        .catch(() => false);
};

export const loginViaUIReal = async (page: Page, user: ITestUser): Promise<void> => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /zaloguj/i }).tap();

    await page.waitForURL(/\/(character-select)?$/, { timeout: 20_000 });
    await waitForAuthToken(page);
};

export const loginViaUI = async (page: Page, user: ITestUser): Promise<void> => {
    await page.addInitScript(() => {
        try {
            window.localStorage.setItem('grimshade_backend_mode', '0');
        } catch {
        }
    });
    const saved = readSavedAuth(user.label);
    if (!saved) {
        await loginViaUIReal(page, user);
        return;
    }

    await page.goto('/login');
    await page.evaluate(
        (s) => {
            try {
                window.localStorage.setItem(s.name, s.value);
            } catch {
            }
        },
        saved,
    );
    await page.goto('/character-select');

    await page.waitForURL(/\/(login|character-select)?$/, { timeout: 20_000 }).catch(() => {});
    if (page.url().includes('/login')) {
        await loginViaUIReal(page, user);
        return;
    }

    await page.waitForURL(/\/(character-select)?$/, { timeout: 20_000 });
    await waitForAuthToken(page);
};

export const loginViaSession = loginViaUI;
