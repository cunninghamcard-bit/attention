/**
 * RESERVED port for a future external agent kernel — a spawned Go binary gated
 * on a `*_BIN` env var, OUTSIDE the JS build (like the removed sidecar), never
 * a workspace member. Interface only: nothing implements it, nothing provides
 * it, and it is absent by default.
 *
 * RED LINE: the kernel owns the AGENT backend (and, in cloud, DB-as-truth) —
 * NEVER the local vault fs, NEVER block rendering. The renderer's
 * markdown/block-render modules must not import this port. It only reserves the
 * seat; wiring it is a separate, future goal.
 */
export interface KernelApi {
  /** One request/response over the future transport (SiYuan-style
   * `HTTP /api/<domain>/<action>`, uniform `{code,msg,data}` envelope). */
  request<T = unknown>(domain: string, action: string, payload?: unknown): Promise<T>;
  /** One multiplexed push channel from the kernel. Returns an unsubscribe. */
  subscribe(handler: (event: unknown) => void): () => void;
}
