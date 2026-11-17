import { create } from 'zustand';

interface UIState {
  mode: 'select' | 'hand';
  menuOpen: boolean;
  message: string | null;
  setMode: (mode: UIState['mode']) => void;
  setMenuOpen: (open: boolean) => void;
  notify: (message: string | null) => void;
}
export const useUIStore = create<UIState>((set) => ({
  mode: 'select',
  menuOpen: false,
  message: null,
  setMode: (mode) => set({ mode }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  notify: (message) => set({ message }),
}));
