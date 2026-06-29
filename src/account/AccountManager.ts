import { Events } from "../core/Events";

export interface AccountProfile {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export class AccountManager extends Events {
  private profile: AccountProfile | null = null;
  private session: AuthSession | null = null;

  signIn(profile: AccountProfile, session: AuthSession): void {
    this.profile = profile;
    this.session = session;
    this.trigger("account-sign-in", profile);
  }

  signOut(): void {
    const oldProfile = this.profile;
    this.profile = null;
    this.session = null;
    this.trigger("account-sign-out", oldProfile);
  }

  getProfile(): AccountProfile | null {
    return this.profile ? { ...this.profile } : null;
  }

  getSession(): AuthSession | null {
    return this.session ? { ...this.session } : null;
  }

  isSignedIn(): boolean {
    return Boolean(this.profile && this.session);
  }
}
