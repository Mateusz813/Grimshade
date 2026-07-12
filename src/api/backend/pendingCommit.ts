
type Flusher = () => Promise<void>;

let _flusher: Flusher | null = null;

export const setPendingCommitFlusher = (fn: Flusher | null): void => {
    _flusher = fn;
};

export const flushPendingCommit = async (): Promise<void> => {
    if (!_flusher) return;
    try {
        await _flusher();
    } catch {
    }
};
