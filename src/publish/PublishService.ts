import type { App } from "../app/App";

export interface PublishSite {
  id: string;
  name: string;
  domain: string;
  vaultId?: string;
}

export interface PublishJob {
  id: string;
  siteId: string;
  paths: string[];
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
}

export interface PublishedFileRecord {
  siteId: string;
  path: string;
  hash: string;
  size: number;
  publishedAt: string;
  url?: string;
}

export class PublishService {
  private sites = new Map<string, PublishSite>();
  private jobs = new Map<string, PublishJob>();
  private files = new Map<string, PublishedFileRecord>();

  constructor(readonly app: App) {}

  registerSite(site: PublishSite): void {
    this.sites.set(site.id, site);
    this.app.workspace.trigger("publish-site-register", site);
  }

  removeSite(id: string): void {
    this.sites.delete(id);
    this.app.workspace.trigger("publish-site-remove", id);
  }

  createJob(siteId: string, paths: string[]): PublishJob {
    const job: PublishJob = {
      id: crypto.randomUUID?.() ?? `${Date.now()}`,
      siteId,
      paths,
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.app.workspace.trigger("publish-job-create", job);
    return job;
  }

  completeJob(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = "completed";
    this.app.workspace.trigger("publish-job-complete", job);
  }

  recordPublishedFile(record: PublishedFileRecord): void {
    this.files.set(this.fileKey(record.siteId, record.path), { ...record });
    this.app.workspace.trigger("publish-file-publish", { ...record });
  }

  removePublishedFile(siteId: string, path: string): void {
    const key = this.fileKey(siteId, path);
    const record = this.files.get(key);
    this.files.delete(key);
    this.app.workspace.trigger("publish-file-remove", record ?? { siteId, path });
  }

  getPublishedFile(siteId: string, path: string): PublishedFileRecord | null {
    const record = this.files.get(this.fileKey(siteId, path));
    return record ? { ...record } : null;
  }

  listPublishedFiles(siteId?: string): readonly PublishedFileRecord[] {
    return [...this.files.values()]
      .filter((record) => !siteId || record.siteId === siteId)
      .map((record) => ({ ...record }));
  }

  clearSite(siteId: string): void {
    for (const record of this.listPublishedFiles(siteId)) this.files.delete(this.fileKey(siteId, record.path));
    this.app.workspace.trigger("publish-site-clear", siteId);
  }

  listSites(): readonly PublishSite[] {
    return [...this.sites.values()].map((site) => ({ ...site }));
  }

  listJobs(): readonly PublishJob[] {
    return [...this.jobs.values()].map((job) => ({ ...job, paths: [...job.paths] }));
  }

  private fileKey(siteId: string, path: string): string {
    return `${siteId}\0${path}`;
  }
}
