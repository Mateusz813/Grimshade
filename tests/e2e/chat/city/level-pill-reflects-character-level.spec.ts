/**
 * Atomic E2E — chat message level pill (`.chat__msg-level`) renderuje
 * wartość z `messages.character_level` w DB, niezależnie czy to my czy
 * inny gracz.
 *
 * Spec (BACKLOG.md punkt 15.8): "Chat character_level pill: pokazuje
 * aktualny level po level-up". Cross-system edge case — chat składa
 * dane historyczne (`messages.character_level` zapisane w momencie wysłania)
 * z runtime fallbackiem dla naszych wiadomości (Chat.tsx linia 315:
 * `msg.character_level ?? (isMe ? characterLevel : null)`).
 *
 * **Test pokrywa primary path**: msg.character_level z DB → pill pokazuje
 * tę wartość. Fallback path (msg.character_level NULL → isMe → użyj
 * runtime characterLevel) zostawiony do unit testu Chat komponentu
 * (`Chat.test.tsx` już istnieje, można dorzucić case).
 *
 * **Adaptacja vs spec "po level-up"**: pełen flow "send msg na lvl 5 →
 * kill mob → level up na lvl 6 → send msg → verify pill = 6" wymaga
 * combat sym. Tutaj symulujemy POST-level-up state przez seed:
 * postać już na lvl 25, w DB jest jej wiadomość z `character_level: 25`
 * → pill renderuje "25". Gdy ktoś zepsuje contract między
 * `messages.character_level` a `.chat__msg-level` (np. zamiast `level`
 * pokazuje `msg.character_class`), regresja jest złapana.
 *
 * ## Setup
 *
 * - Knight, level 25, hp_regen=0, mp_regen=0.
 * - Direct admin insert do `messages` table:
 *   `{ channel: 'city', character_name: <nick>, character_class: 'Knight',
 *      character_level: 25, content: 'E2E test message', user_id: <userId> }`.
 *
 * ## Actions
 *
 * 1. Login → Town → /chat.
 * 2. Wait for messages list to hydrate (city tab is default).
 * 3. Find our seeded message row by content text.
 * 4. Verify `.chat__msg-level` w tym rowie = "25".
 *
 * ## Cleanup
 *
 * `messages` table NIE jest w `CHARACTER_CHILD_TABLES` w `cleanup.ts`
 * (komentarz w `tests/e2e/README.md` linia 137-139: "messages używa
 * user_id, nie character_id"). Cleanup postaci NIE rusza messages.
 * Aby uniknąć spam-u w chat history, jawnie kasujemy w `finally`
 * przez admin client (delete WHERE id = <seedMsgId>).
 *
 * Cleanup: try/finally → admin.from('messages').delete().eq('id', msgId)
 *                     + cleanupCharacterById(createdId).
 *
 * ## Why anchor on content text (not nick)
 *
 * Channel `city` to PROD chat — może być pełen wiadomości innych graczy
 * (a nawet historycznych wiadomości testowych z `messages.user_id` =
 * primary test user, bo nigdy nie kasujemy). Content `'E2E test message'`
 * jest unikalne per-run dzięki suffix-owi z `Date.now()`, więc selector
 * nie collison-uje z innymi wiadomościami w feed-zie.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { getAdminClient, findUserIdByEmail } from '../../fixtures/adminClient';

test.describe('Chat › City', { tag: '@chat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('city channel message renders level pill with character_level value from DB', async ({ page }) => {
        const nick = generateTestCharacterName();
        const uniqueContent = `E2E test message ${Date.now()}`;
        let createdId: string | null = null;
        let seededMsgId: string | null = null;

        try {
            // 1. Seed Knight na lvl 25. character.level = 25 → handleSend
            //    z prawdziwego UI flow zapisałby `character_level: 25` w DB.
            //    My pomijamy UI flow i wsadzamy bezpośrednio rekord do DB
            //    z tym levelem.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Insert message via admin (bypass RLS — service_role).
            //    Schema: { channel, character_name, character_class,
            //              character_level, content, user_id }.
            //    Zwraca {id} które trzymamy do cleanup-u.
            const admin = getAdminClient();
            const userId = await findUserIdByEmail(testUsers.primary.email);
            if (!userId) throw new Error('[test 15.8] primary userId not found');

            const { data: msgRow, error: insertErr } = await admin
                .from('messages')
                .insert({
                    channel: 'city',
                    character_name: nick,
                    character_class: 'Knight',
                    character_level: 25,
                    content: uniqueContent,
                    user_id: userId,
                })
                .select('id')
                .single();

            if (insertErr) throw new Error(`[test 15.8] message insert failed: ${insertErr.message}`);
            seededMsgId = msgRow.id as string;

            // 3. Login + select character + /chat.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 4. Navigate to /chat → GlobalChat mount-uje city tab as default
            //    (chatTabsStore.ensureCityTab w GlobalChat.tsx linia 30).
            await page.goto('/chat');
            await expect(page.locator('.global-chat')).toBeVisible({ timeout: 10_000 });

            // 5. Wait for messages list hydration. Chat.tsx fetches `getMessages(channel)`
            //    na mount + polluje every 4s. Możemy poczekać aż nasza
            //    wiadomość się pojawi w DOM. Selector: `.chat__msg` z
            //    name "E2E test message <ts>" w treści.
            //
            //    Chat.tsx ~317-422 renderuje `.chat__msg` rowy.
            //    Content text leży w `.chat__msg-content` (linia ~415) lub
            //    bezpośrednio w textNodes — anchor po contentText.
            //
            //    NOTE: `.chat__msg` może być wiele dla różnych messages,
            //    `hasText` filtruje po naszym uniqueContent.
            const myMsg = page.locator('.chat__msg', { hasText: uniqueContent }).first();
            await expect(myMsg).toBeVisible({ timeout: 15_000 });

            // 6. KRYTYCZNA ASERCJA: pill `.chat__msg-level` w naszym rowie
            //    pokazuje "25" (z `msg.character_level`).
            //    Chat.tsx linia 324-328: `<span className="chat__msg-level">{level}</span>`
            //    gdzie level = msg.character_level ?? (isMe ? characterLevel : null).
            //    Nasza msg ma character_level=25 → primary path, level=25.
            await expect(myMsg.locator('.chat__msg-level')).toHaveText('25');

            // 7. Tooltip pill = "Poziom 25" (linia 325 title attr) — sanity.
            await expect(myMsg.locator('.chat__msg-level')).toHaveAttribute('title', 'Poziom 25');
        } finally {
            // Delete seeded message — `messages` NIE jest w cleanup tables
            // (CHARACTER_CHILD_TABLES w cleanup.ts), więc musimy jawnie.
            if (seededMsgId) {
                try {
                    await getAdminClient().from('messages').delete().eq('id', seededMsgId);
                } catch {
                    // Best-effort — orphan messages siedzą w tabeli, nieszkodliwe
                    // (test używa unique content w treści, więc nie wpływa na
                    // przyszłe runy).
                }
            }
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
