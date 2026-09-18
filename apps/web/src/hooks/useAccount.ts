import { useEffect, useState } from "react";
import { auth, type UserInfo } from "../services/auth";
import { sync, type SyncState } from "../services/sync";

/** Who is signed in on this device, kept current. */
export function useAuthUser(): UserInfo {
  const [user, setUser] = useState(() => auth().currentUser());
  useEffect(() => auth().subscribe(setUser), []);
  return user;
}

/** What sync is doing, kept current. */
export function useSyncState(): SyncState {
  const [state, setState] = useState(() => sync().state());
  useEffect(() => {
    setState(sync().state());
    return sync().subscribe(setState);
  }, []);
  return state;
}
