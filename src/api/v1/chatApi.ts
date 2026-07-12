import { supabase } from '../../lib/supabase';
import { BaseApi } from '../BaseApi';

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

const CHANNEL_MESSAGE_CAP = 100;

const GUILD_CHANNEL_CAP = 500;

class ChatApi extends BaseApi {
    getMessages = async (channel: string, limit = CHANNEL_MESSAGE_CAP): Promise<IMessage[]> => {
        const encoded = encodeURIComponent(channel);
        const data = await this.get<IMessage[]>({
            url: `/rest/v1/messages?channel=eq.${encoded}&order=created_at.desc&limit=${limit}&select=*`,
        });
        return [...data].reverse();
    };

    private trimChannel = async (channel: string, cap: number = CHANNEL_MESSAGE_CAP): Promise<void> => {
        try {
            const encoded = encodeURIComponent(channel);
            const rows = await this.get<Pick<IMessage, 'id'>[]>({
                url:
                    `/rest/v1/messages?channel=eq.${encoded}` +
                    `&order=created_at.desc&offset=${cap}&limit=500&select=id`,
            });
            if (!Array.isArray(rows) || rows.length === 0) return;
            const ids = rows.map((r) => `"${r.id}"`).join(',');
            await this.delete({ url: `/rest/v1/messages?id=in.(${ids})` });
        } catch {
        }
    };

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
        if (channel.startsWith('pm_')) {
            void this.trimChannel(channel, CHANNEL_MESSAGE_CAP);
        } else if (channel.startsWith('guild_')) {
            void this.trimChannel(channel, GUILD_CHANNEL_CAP);
        }
        return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    };

    postSystemEvent = async (
        characterName: string,
        characterClass: string,
        characterLevel: number,
        content: string,
    ): Promise<IMessage | null> => {
        return this.sendMessage(
            'system',
            content,
            characterName,
            characterClass,
            characterLevel,
        );
    };

    subscribeAll = (onMessage: (msg: IMessage) => void): (() => void) => {
        const uniqueName = `chat:all:${Math.random().toString(36).slice(2, 10)}:${Date.now()}`;
        const sub = supabase
            .channel(uniqueName)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => onMessage(payload.new as IMessage),
            )
            .subscribe();
        return () => { void supabase.removeChannel(sub); };
    };

    subscribe = (
        channel: string,
        onMessage: (msg: IMessage) => void,
    ): (() => void) => {
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
