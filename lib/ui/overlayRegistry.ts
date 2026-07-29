export interface OverlayRegistration {
  close: () => void;
}

export function createOverlayRegistry() {
  let activeId: string | null = null;
  const registrations = new Map<string, OverlayRegistration>();

  return {
    register(id: string, registration: OverlayRegistration) {
      registrations.set(id, registration);
      return () => {
        if (registrations.get(id) === registration) {
          registrations.delete(id);
        }
        if (activeId === id) activeId = null;
      };
    },
    activate(id: string) {
      const previousId = activeId;
      if (previousId && previousId !== id) {
        registrations.get(previousId)?.close();
      }
      activeId = id;
    },
    deactivate(id: string) {
      if (activeId === id) activeId = null;
    },
    active() {
      return activeId;
    },
  };
}
