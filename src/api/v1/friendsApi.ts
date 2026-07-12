import { BaseApi } from '../BaseApi';


export interface IFriendCharacterInfo {
    id: string;
    name: string;
    class: string;
    level: number;
    updated_at: string;
    online: boolean;
}

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

interface IRawCharacter {
    id: string;
    name: string;
    class: string;
    level: number;
    updated_at: string;
}

const decorate = (row: IRawCharacter): IFriendCharacterInfo => {
    const updated = new Date(row.updated_at).getTime();
    const online = Number.isFinite(updated) && Date.now() - updated < ONLINE_THRESHOLD_MS;
    return {
        id: row.id,
        name: row.name,
        class: row.class,
        level: row.level,
        updated_at: row.updated_at,
        online,
    };
};

class FriendsApi extends BaseApi {
    findByName = async (name: string): Promise<IFriendCharacterInfo | null> => {
        const clean = name.trim();
        if (!clean) return null;
        const pattern = `${clean}*`;
        const encoded = encodeURIComponent(pattern);
        const data = await this.get<IRawCharacter[]>({
            url: `/rest/v1/characters?name=ilike.${encoded}&select=id,name,class,level,updated_at&order=name.asc&limit=5`,
        });
        if (!data.length) return null;
        const lc = clean.toLowerCase();
        const exact = data.find((r) => r.name.toLowerCase() === lc);
        return decorate(exact ?? data[0]);
    };

    findManyByName = async (names: string[]): Promise<IFriendCharacterInfo[]> => {
        const clean = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
        if (!clean.length) return [];
        const list = clean.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',');
        const data = await this.get<IRawCharacter[]>({
            url: `/rest/v1/characters?name=in.(${encodeURIComponent(list)})&select=id,name,class,level,updated_at`,
        });
        return data.map(decorate);
    };
}

export const friendsApi = new FriendsApi();

export const buildPmChannel = (nameA: string, nameB: string): string => {
    const [first, second] = [nameA, nameB]
        .map((n) => n.trim())
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return `pm_${first}_${second}`;
};
