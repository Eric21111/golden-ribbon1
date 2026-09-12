import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react';

interface ManagerDrawerContextValue {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const ManagerDrawerContext = createContext<ManagerDrawerContextValue | null>(null);

export function ManagerDrawerProvider({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);

  const value = useMemo<ManagerDrawerContextValue>(
    () => ({
      open,
      openDrawer: () => setOpen(true),
      closeDrawer: () => setOpen(false),
    }),
    [open]
  );

  return <ManagerDrawerContext.Provider value={value}>{children}</ManagerDrawerContext.Provider>;
}

export function useManagerDrawer() {
  const context = useContext(ManagerDrawerContext);
  if (!context) throw new Error('useManagerDrawer must be used within a ManagerDrawerProvider');
  return context;
}
