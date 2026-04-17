import { supabase } from '../../lib/supabase';
import { BaseApi } from '../BaseApi';

/**
 * Global city chat API — reads/writes the `messages` table and streams new
 * inserts over Supabase Realtime. The schema includes `character_class` and
 * `character_level` so each message can render the sender's class icon and
 * level pill, even for historical messages rendered cold.
 *
 * Required schema migration if not yet applied (run once in Supabase SQL Editor):
 *
 *   ALTER TABLE messages
 *     ADD COLUMN IF NOT EXISTS character_class TEXT,
 *     ADD COLUMN IF NOT EXISTS character_level INTEGER;
 *
 * `character_class` was already listed in CLAUDE.md schema but the old client
 * was not sending it — that's why chat sends were failing for players whose
 * row had a NOT NULL constraint on it. Now we always include it.
 */
export interface IMessage {
    id: string;
    channel: string;
    character_name: string;
    character_class?: string | null;
    character_level?: number | null;
    content: string;
    created_at: string;
}

interface ISendMessagePayload {
    channel: string;
    character_name: string;
    character_class: string;
    character_level: number;
    content: string;
    user_id: string;
}

class ChatApi extends BaseApi {
    getMessages = async (channel: string, limit = 50): Promise<IMessage[]> => {
        const encoded = encodeURIComponent(channel);
        const data = await this.get<IMessage[]>({
            url: `/rest/v1/messages?channel=eq.${encoded}&order=created_at.desc&limit=${limit}&select=*`,
        });
        return [...data].reverse();
    };

    /**
     * Insert a message and return the created row so callers can push it into
     * local state immediately. We pass `Prefer: return=representation` so
     * Supabase returns the inserted row — without this the chat UI would wait
     * for the Realtime `postgres_changes` event to round-trip before showing
     * the sender's own message. The local Chat subscription dedupes by `id`,
     * so pushing optimistically here AND letting Realtime fire is safe.
     */
    sendMessage = async (
        channel: string,
        content: string,
        characterName: string,
        characterClass: string,
        characterLevel: number,
    ): Promise<IMessage | null> => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return null;
        const rows = await this.post<ISendMessagePayload, IMessage[]>({
            url: '/rest/v1/messages',
            data: {
                channel,
                character_name: characterName,
                character_class: characterClass,
                character_level: characterLevel,
                content: content.trim().slice(0, 300),
                user_id: session.user.id,
            },
            config: {
                headers: { Prefer: 'return=representation' },
            },
        });
        return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    };

    subscribe = (
        channel: string,
        onMessage: (msg: IMessage) => void,
    ): (() => void) => {
        // Use a unique channel name per subscription to avoid the
        // "cannot add postgres_changes callbacks after subscribe()" error that
        // happens when Supabase's internal channel registry returns an existing
        // (already-subscribed) channel of the same name on re-mount.
        const uniqueName = `chat:${channel}:${Math.random().toString(36).slice(2, 10)}:${Date.now()}`;
        const sub = supabase
            .channel(uniqueName)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `channel=eq.${channel}`,
                },
                (payload) => onMessage(payload.new as IMessage),
            )
            .subscribe();

        return () => { void supabase.removeChannel(sub); };
    };
}

export const chatApi = new ChatApi();
