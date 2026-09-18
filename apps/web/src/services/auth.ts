/**
 * Identity seam. No account is ever required for a local feature. The local provider reports the
 * anonymous "local" owner used on every stored record, and refuses to sign anyone in.
 *
 * Signing in is by email: `start` sends a link, and the link brings a code back to `finish`.
 */
export interface UserInfo {
  id: string;
  displayName: string;
  anonymous: boolean;
  /** The name of the public page, when one has been chosen. */
  handle?: string | null;
}

export interface DeviceInfo {
  id: string;
  deviceName: string;
  lastSeenAt: string;
  current: boolean;
}

export interface AuthService {
  currentUser(): UserInfo;
  /** Send a sign-in link to this address. */
  start(email: string): Promise<void>;
  /** Take the code the link carried and become signed in on this device. */
  finish(code: string): Promise<UserInfo>;
  signOut(): Promise<void>;
  /** Every device signed in to the account, this one marked. */
  devices(): Promise<DeviceInfo[]>;
  signOutDevice(id: string): Promise<void>;
  /** Remove everything the server holds for the account, and sign this device out. */
  deleteAccount(): Promise<void>;
  /** Choose the public page's name, or clear it with an empty string. */
  setHandle(handle: string): Promise<UserInfo>;
  subscribe(listener: (u: UserInfo) => void): () => void;
}

export const LOCAL_USER: UserInfo = { id: "local", displayName: "Local", anonymous: true };

const unavailable = () => Promise.reject(new Error("No account service is configured."));

export const localAuth: AuthService = {
  currentUser: () => LOCAL_USER,
  start: unavailable,
  finish: unavailable,
  signOut: async () => undefined,
  devices: async () => [],
  signOutDevice: async () => undefined,
  deleteAccount: async () => undefined,
  setHandle: unavailable,
  subscribe: () => () => undefined,
};

let current: AuthService = localAuth;
export function auth(): AuthService {
  return current;
}
export function setAuthService(s: AuthService): void {
  current = s;
}
