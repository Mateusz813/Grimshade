
import { devices, type Browser, type Page } from '@playwright/test';
import { testUsers } from './testUsers';
import { loginViaUI } from './login';
import { cleanupCharacterById } from './cleanup';
import { getAdminClient } from './adminClient';

export interface IMultiContextHandles {
    primaryPage: Page;
    secondaryPage: Page;
    cleanup: (args: ICleanupArgs) => Promise<void>;
}

export interface ICleanupArgs {
    primaryCharId: string | null;
    secondaryCharId: string | null;
}

export const openMultiContext = async (
    browser: Browser,
): Promise<IMultiContextHandles> => {
    const mobileProfile = devices['iPhone 13'];

    const [ctxPrimary, ctxSecondary] = await Promise.all([
        browser.newContext({ ...mobileProfile }),
        browser.newContext({ ...mobileProfile }),
    ]);

    const primaryPage = await ctxPrimary.newPage();
    const secondaryPage = await ctxSecondary.newPage();

    await Promise.all([
        loginViaUI(primaryPage, testUsers.primary),
        loginViaUI(secondaryPage, testUsers.secondary),
    ]);

    const cleanup = async (args: ICleanupArgs): Promise<void> => {
        const charIds = [args.primaryCharId, args.secondaryCharId].filter(
            (id): id is string => id !== null,
        );
        if (charIds.length > 0) {
            try {
                const admin = getAdminClient();
                const idList = charIds.map((id) => `"${id}"`).join(',');
                await admin
                    .from('parties')
                    .delete()
                    .or(`leader_id.in.(${idList})`);
            } catch {
            }
        }

        const charPromises: Promise<unknown>[] = [];
        if (args.primaryCharId) {
            charPromises.push(cleanupCharacterById(args.primaryCharId));
        }
        if (args.secondaryCharId) {
            charPromises.push(cleanupCharacterById(args.secondaryCharId));
        }
        await Promise.all(charPromises);

        await Promise.all([
            ctxPrimary.close(),
            ctxSecondary.close(),
        ]);
    };

    return { primaryPage, secondaryPage, cleanup };
};
