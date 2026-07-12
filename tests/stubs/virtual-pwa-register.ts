export const registerSW = (
  _options?: unknown,
): ((reloadPage?: boolean) => Promise<void>) => () => Promise.resolve();
