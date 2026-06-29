import type { AccountManager } from "./AccountManager";

export type LicenseFeature = "sync" | "publish" | "commercial-use" | "early-access";

export interface LicenseState {
  accountId: string;
  plan: "free" | "sync" | "publish" | "commercial";
  features: LicenseFeature[];
  expiresAt?: string;
}

export class LicenseManager {
  private license: LicenseState | null = null;

  constructor(readonly accounts: AccountManager) {}

  setLicense(license: LicenseState): void {
    this.license = license;
  }

  clearLicense(): void {
    this.license = null;
  }

  hasFeature(feature: LicenseFeature): boolean {
    const profile = this.accounts.getProfile();
    if (!profile || !this.license || this.license.accountId !== profile.id) return false;
    return this.license.features.includes(feature);
  }

  getLicense(): LicenseState | null {
    return this.license ? structuredClone(this.license) : null;
  }
}
