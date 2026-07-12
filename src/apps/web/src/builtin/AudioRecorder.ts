import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { Notice } from "../ui/Notice";
import { MarkdownView } from "../views/MarkdownView";

interface RecorderFormat {
  mimeType: string;
  extension: string;
}

export class AudioRecorderController {
  recording = false;
  recorder: MediaRecorder | null = null;
  extension = "webm";
  private chunks: Blob[] = [];
  private ribbonEl: HTMLElement | null = null;

  constructor(readonly app: App) {}

  async start(): Promise<void> {
    if (this.recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      new Notice("Audio recording is not supported in this environment.");
      return;
    }
    const format = chooseRecorderFormat();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.chunks = [];
    this.extension = format.extension;
    this.recorder = new MediaRecorder(
      stream,
      format.mimeType ? { mimeType: format.mimeType } : undefined,
    );
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.recorder.addEventListener(
      "stop",
      () => {
        for (const track of stream.getTracks()) track.stop();
        void this.finishRecording(format);
      },
      { once: true },
    );
    this.recorder.start();
    this.recording = true;
    this.updateRibbon();
    this.app.workspace.trigger("audio-recorder-start");
  }

  stop(): void {
    if (!this.recording || !this.recorder) return;
    this.recorder.stop();
  }

  toggle(): void {
    if (this.recording) this.stop();
    else void this.start();
  }

  setRibbonEl(el: HTMLElement): void {
    this.ribbonEl = el;
    this.updateRibbon();
  }

  private async finishRecording(format: RecorderFormat): Promise<void> {
    const blob = new Blob(this.chunks, { type: format.mimeType || "audio/webm" });
    const path = await this.app.vault.getAvailablePathForAttachments(
      `Recording ${formatTimestamp(new Date())}`,
      format.extension,
      this.app.workspace.getActiveFile(),
    );
    const file = await this.app.vault.createBinary(path, await blob.arrayBuffer());
    this.recording = false;
    this.recorder = null;
    this.chunks = [];
    this.updateRibbon();
    const view = this.app.workspace.activeLeaf?.view;
    if (view instanceof MarkdownView) view.insertText(`![[${file.path}]]`);
    else await this.app.workspace.openFile(file, { active: true });
    this.app.workspace.trigger("audio-recorder-stop", file);
  }

  private updateRibbon(): void {
    this.ribbonEl?.classList.toggle("is-active", this.recording);
  }
}

export function createAudioRecorderPluginDefinition(): InternalPluginDefinition {
  let controller: AudioRecorderController | null = null;
  return {
    id: "audio-recorder",
    name: "Audio recorder",
    description: "Record audio and save it as an attachment.",
    defaultOn: false,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new AudioRecorderController(app);
      plugin.instance = controller;
      plugin.registerGlobalCommand({
        id: "audio-recorder:start",
        name: "Start recording audio",
        icon: "lucide-mic",
        checkCallback: (checking) => {
          const available = !controller?.recording;
          if (!checking && available) void controller?.start();
          return available;
        },
      });
      plugin.registerGlobalCommand({
        id: "audio-recorder:stop",
        name: "Stop recording audio",
        icon: "lucide-square",
        checkCallback: (checking) => {
          const available = Boolean(controller?.recording);
          if (!checking && available) controller?.stop();
          return available;
        },
      });
      plugin.registerRibbonItem("Start/stop audio recording", "lucide-mic", () =>
        controller?.toggle(),
      );
    },
    onEnable(app: App) {
      const button = app.workspace.leftRibbon.containerEl.querySelector<HTMLElement>(
        '.side-dock-ribbon-action[aria-label="Start/stop audio recording"]',
      );
      if (button) controller?.setRibbonEl(button);
    },
    onDisable() {
      controller?.stop();
    },
  };
}

function chooseRecorderFormat(): RecorderFormat {
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("audio/mp4")) {
    return { mimeType: "audio/mp4", extension: "m4a" };
  }
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("audio/webm")) {
    return { mimeType: "audio/webm", extension: "webm" };
  }
  return { mimeType: "", extension: "webm" };
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}
