import type { NativeBridge } from "./NativeBridge";

export interface PreloadApiShape {
  invoke<T = unknown, R = unknown>(channel: string, payload?: T): Promise<R>;
  platform: "desktop" | "mobile" | "web";
}

export class PreloadApi implements PreloadApiShape {
  readonly platform = "desktop" as const;

  constructor(readonly bridge: NativeBridge) {}

  invoke<T = unknown, R = unknown>(channel: string, payload?: T): Promise<R> {
    return this.bridge.invoke<T, R>({ channel, payload });
  }
}
