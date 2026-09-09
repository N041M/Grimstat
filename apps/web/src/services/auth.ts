/**
 * Identity seam. No account is ever required for a local feature. The local provider
 * reports the anonymous "local" owner used on every stored record.
 */
export interface UserInfo {
  id: string;
  displayName: string;
  anonymous: boolean;
}

export interface AuthService {
  currentUser(): UserInfo;
  signIn(): Promise<UserInfo>;
  signOut(): Promise<void>;
  subscribe(listener: (u: UserInfo) => void): () => void;
}

const LOCAL_USER: UserInfo = { id: "local", displayName: "Local", anonymous: true };

export const localAuth: AuthService = {
  currentUser: () => LOCAL_USER,
  signIn: async () => LOCAL_USER,
  signOut: async () => undefined,
  subscribe: () => () => undefined,
};

let current: AuthService = localAuth;
export function auth(): AuthService {
  return current;
}
export function setAuthService(s: AuthService): void {
  current = s;
}
