
declare global {
    interface Window {
        __grimshadeReady?: boolean;
    }
}

export const markAppReady = (): void => {
    if (typeof window !== 'undefined') {
        window.__grimshadeReady = true;
    }
};

export const markAppRestoring = (): void => {
    if (typeof window !== 'undefined') {
        window.__grimshadeReady = false;
    }
};
