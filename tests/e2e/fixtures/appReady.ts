
import { type Page } from '@playwright/test';

export const waitForAppReady = async (page: Page): Promise<void> => {
    await page.waitForFunction(
        () => window.__grimshadeReady === true,
        { timeout: 20_000 },
    );
};

declare global {
    interface Window {
        __grimshadeReady?: boolean;
    }
}
