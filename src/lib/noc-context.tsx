import { createContext, useContext, useState, useCallback } from 'react';

interface NocContextValue {
  fullscreen: boolean;
  toggleFullscreen: () => void;
}

const NocContext = createContext<NocContextValue>({ fullscreen: false, toggleFullscreen: () => {} });

export function NocProvider({ children }: { children: React.ReactNode }) {
  const [fullscreen, setFullscreen] = useState(false);
  const toggleFullscreen = useCallback(() => setFullscreen(v => !v), []);
  return <NocContext.Provider value={{ fullscreen, toggleFullscreen }}>{children}</NocContext.Provider>;
}

export const useNoc = () => useContext(NocContext);
