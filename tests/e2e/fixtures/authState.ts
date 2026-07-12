
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type TAuthLabel = 'primary' | 'secondary' | 'admin';

export interface ISavedAuth {
    name: string;
    value: string;
}

const AUTH_DIR = resolve(process.cwd(), 'playwright/.auth');

export const supabaseAuthStorageKey = (supabaseUrl: string): string => {
    const ref = new URL(supabaseUrl).hostname.split('.')[0];
    return `sb-${ref}-auth-token`;
};

const authFilePath = (label: TAuthLabel): string => resolve(AUTH_DIR, `${label}.json`);

export const writeSavedAuth = (label: TAuthLabel, saved: ISavedAuth): void => {
    mkdirSync(AUTH_DIR, { recursive: true });
    writeFileSync(authFilePath(label), JSON.stringify(saved), 'utf8');
};

export const readSavedAuth = (label: TAuthLabel): ISavedAuth | null => {
    const path = authFilePath(label);
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as ISavedAuth;
    } catch {
        return null;
    }
};
