import { useCallback, useEffect, useState } from "react";

const KEY = "active_client_id";
const EVENT = "active-client-change";

export function getActiveClientId(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

export function setActiveClientId(id: string) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(KEY, id);
  else window.localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * The client the person is currently working on, shared across every screen so it is always
 * obvious whose data is on the page.
 */
export function useActiveClient() {
  const [clientId, setId] = useState<string>("");

  useEffect(() => {
    setId(getActiveClientId());
    const sync = () => setId(getActiveClientId());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const select = useCallback((id: string) => {
    setActiveClientId(id);
    setId(id);
  }, []);

  return { clientId, setClientId: select };
}
