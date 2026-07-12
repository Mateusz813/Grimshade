
export interface ITestUser {
    label: 'primary' | 'secondary' | 'admin';
    email: string;
    password: string;
}

const requireEnv = (key: string): string => {
    const value = process.env[key];
    if (!value) {
        throw new Error(
            `[testUsers] Missing env var: ${key}. ` +
            'Skopiuj `.env.test.example` -> `.env.test` i wpisz credentiale, ' +
            'albo wyeksportuj zmienną przed `npm run test:e2e`.',
        );
    }
    return value;
};

export const testUsers = {
    primary: {
        label: 'primary',
        email: requireEnv('E2E_USER_EMAIL'),
        password: requireEnv('E2E_USER_PASSWORD'),
    },
    secondary: {
        label: 'secondary',
        email: requireEnv('E2E_USER2_EMAIL'),
        password: requireEnv('E2E_USER2_PASSWORD'),
    },
    admin: {
        label: 'admin',
        email: requireEnv('E2E_ADMIN_EMAIL'),
        password: requireEnv('E2E_ADMIN_PASSWORD'),
    },
} as const satisfies Record<string, ITestUser>;
