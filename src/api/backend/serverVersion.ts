const saveKey = (charId: string): string => `dungeon_rpg_save_char_${charId}`;

interface ILocalSaveShape {
    state?: Record<string, unknown>;
    updated_at?: string;
    server_version?: string | null;
}

export const readServerVersion = (charId: string): string | null => {
    try {
        const raw = localStorage.getItem(saveKey(charId));
        if (!raw) return null;
        const version = (JSON.parse(raw) as ILocalSaveShape).server_version;
        return version && version.trim() !== '' ? version : null;
    } catch {
        return null;
    }
};

export const bumpServerVersion = (charId: string, version: string | null | undefined): void => {
    if (!version) return;
    try {
        const raw = localStorage.getItem(saveKey(charId));
        if (!raw) return;
        const save = JSON.parse(raw) as ILocalSaveShape;
        save.server_version = version;
        localStorage.setItem(saveKey(charId), JSON.stringify(save));
    } catch {
    }
};

export const extractCharIdFromUrl = (url: string): string | null => {
    const match = /\/characters\/([0-9a-fA-F-]{36})\//.exec(url);
    return match ? match[1] : null;
};
