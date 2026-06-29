import type { App } from "../app/App";

export interface RemoteSyncEndpoint {
  id: string;
  name: string;
  url: string;
  authType: "none" | "token" | "account";
}

export interface RemoteSyncPlan {
  vaultId: string;
  endpointId: string;
  includePatterns: string[];
  excludePatterns: string[];
}

export class RemoteSyncProvider {
  private endpoints = new Map<string, RemoteSyncEndpoint>();
  private plans = new Map<string, RemoteSyncPlan>();

  constructor(readonly app: App) {}

  registerEndpoint(endpoint: RemoteSyncEndpoint): void {
    this.endpoints.set(endpoint.id, endpoint);
    this.app.workspace.trigger("remote-sync-endpoint-register", endpoint);
  }

  unregisterEndpoint(id: string): void {
    this.endpoints.delete(id);
    this.app.workspace.trigger("remote-sync-endpoint-unregister", id);
  }

  setPlan(plan: RemoteSyncPlan): void {
    this.plans.set(plan.vaultId, plan);
    this.app.workspace.trigger("remote-sync-plan-change", plan);
  }

  getPlan(vaultId: string): RemoteSyncPlan | null {
    const plan = this.plans.get(vaultId);
    return plan ? structuredClone(plan) : null;
  }

  listEndpoints(): readonly RemoteSyncEndpoint[] {
    return [...this.endpoints.values()].map((endpoint) => ({ ...endpoint }));
  }
}
