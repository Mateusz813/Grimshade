let _token: string | null = null;

export const setAuthToken = (t: string | null): void => {
    _token = t;
};

export const getAuthToken = (): string | null => _token;
