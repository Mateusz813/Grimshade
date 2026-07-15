interface ICacheEntry {
    at: number;
    value: unknown;
}

const store = new Map<string, ICacheEntry>();

export const cachedRead = async <R>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<R>,
): Promise<R> => {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && now - hit.at < ttlMs) {
        return hit.value as R;
    }
    const value = await fetcher();
    store.set(key, { at: now, value });
    return value;
};

export const invalidateQueryCache = (predicate?: (key: string) => boolean): void => {
    if (!predicate) {
        store.clear();
        return;
    }
    for (const key of [...store.keys()]) {
        if (predicate(key)) store.delete(key);
    }
};
