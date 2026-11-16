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

interface LocalAsset {
  url: string;
  name: string;
}
export const useLocalAssets = create<{
  assets: Record<string, LocalAsset>;
  add: (file: File) => string | null;
}>((set) => ({
  assets: {},
  add: (file) => {
    if (!file.type.startsWith('image/')) {
      useUIStore.getState().notify('Choose an image file.');
      return null;
    }
    if (file.size > 20 * 1024 * 1024) {
      useUIStore.getState().notify('Choose an image smaller than 20 MB.');
      return null;
    }
    const id = crypto.randomUUID();
    set((state) => ({
      assets: {
        ...state.assets,
        [id]: { url: URL.createObjectURL(file), name: file.name },
      },
    }));
    return id;
  },
}));

// Keep URLs alive for undo/redo; release the session's URLs on navigation.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted)
      Object.values(useLocalAssets.getState().assets).forEach((asset) =>
        URL.revokeObjectURL(asset.url),
      );
  });
}
