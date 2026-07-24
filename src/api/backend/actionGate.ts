let inFlight = 0;
let cooldownUntil = 0;

const TRAILING_COOLDOWN_MS = 1200;

export const actionGateEnter = (): void => {
    inFlight += 1;
};

export const actionGateLeave = (): void => {
    inFlight = Math.max(0, inFlight - 1);
    cooldownUntil = Date.now() + TRAILING_COOLDOWN_MS;
};

export const isActionGateBusy = (): boolean =>
    inFlight > 0 || Date.now() < cooldownUntil;

export const resetActionGate = (): void => {
    inFlight = 0;
    cooldownUntil = 0;
};
