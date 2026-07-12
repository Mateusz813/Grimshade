import { create } from 'zustand';


interface IAppRouteState {
    isCharacterless: boolean;
    setIsCharacterless: (value: boolean) => void;
}

export const useAppRouteStore = create<IAppRouteState>()((set) => ({
    isCharacterless: false,
    setIsCharacterless: (value) => set({ isCharacterless: value }),
}));
