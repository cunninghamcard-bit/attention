// Mock engine: a scripted stream for offline UI work. Exercises every
// canonical event shape — streaming text, tool calls including a failure,
// compaction, usage — so the whole card family renders without a real LLM.
import type { Engine, EngineEmit } from "./engine";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const counters = new Map<string, number>();

function nextMessageId(agentId: string): string {
  const next = (counters.get(agentId) ?? 0) + 1;
  counters.set(agentId, next);
  return `${agentId}-m${next}`;
}

async function runScript(agentId: string, runId: string, prompt: string, emit: EngineEmit): Promise<void> {
  if (prompt.includes("compact")) emit({ type: "context.compacted", preTokens: 52000, trigger: "auto" });
  const messageId = nextMessageId(agentId);
  emit({ type: "message.started", messageId, role: "assistant" });

  emit({ type: "part.opened", messageId, partIndex: 0, partType: "thinking" });
  for (const chunk of "用户想看演示。先流式输出一段包含各种元素的 markdown,然后跑几个工具,其中一个故意失败。".match(/.{1,6}/gs) ?? []) {
    emit({ type: "part.delta", messageId, partIndex: 0, delta: chunk });
    await sleep(80);
  }
  emit({ type: "part.closed", messageId, partIndex: 0 });

  emit({ type: "part.opened", messageId, partIndex: 1, partType: "text" });
  const intro = `你发来了:**${prompt.slice(0, 40)}**\n\n下面演示流式渲染,详见 [[Welcome]]:\n\n## 一个标题\n\n| 特性 | 状态 |\n| --- | --- |\n| 表格流式 | ✅ |\n| 内链元素 | ✅ |\n\n\`\`\`ts\nconst answer = 42;\nconsole.log(answer);\n\`\`\`\n\n\`\`\`mermaid\ngraph LR\n  A[SSE] --> B[reducer] --> C[ChatView]\n\`\`\`\n\n`;
  for (const chunk of intro.match(/.{1,7}/gs) ?? []) {
    emit({ type: "part.delta", messageId, partIndex: 1, delta: chunk });
    await sleep(24);
  }
  emit({ type: "part.closed", messageId, partIndex: 1 });

  const toolCalls: Array<[string, string, string, string?]> = [
    ["Bash", '{"command":"echo hello"}', "hello"],
    ["Edit", '{"file_path":"src/main.ts","old_string":"const a = 1;\\nconst b = 2;","new_string":"const a = 1;\\nconst b = 3;\\nconst c = 4;"}', "ok"],
    ["Read", '{"file_path":"src/missing.ts"}', "ENOENT: no such file", "ENOENT: no such file"],
    ["Grep", '{"pattern":"ChatView"}', "12 matches"],
  ];
  for (let index = 0; index < toolCalls.length; index++) {
    const [toolName, input, result, error] = toolCalls[index];
    const partIndex = index + 2;
    emit({ type: "part.opened", messageId, partIndex, partType: "tool", toolName });
    emit({ type: "part.delta", messageId, partIndex, delta: input });
    emit({ type: "part.closed", messageId, partIndex });
    await sleep(350);
    emit({ type: "part.closed", messageId, partIndex, result, ...(error ? { error } : {}) });
  }

  emit({ type: "part.opened", messageId, partIndex: 6, partType: "text" });
  const outro = "工具跑完了。*流式*结束,这一条消息现在归档,DOM 原地移交。";
  for (const chunk of outro.match(/.{1,5}/gs) ?? []) {
    emit({ type: "part.delta", messageId, partIndex: 6, delta: chunk });
    await sleep(30);
  }
  emit({ type: "part.closed", messageId, partIndex: 6 });
  emit({ type: "message.closed", messageId });
  emit({
    type: "run.closed",
    runId,
    status: "completed",
    usage: { inputTokens: 12400, outputTokens: 860, totalTokens: 13260, costUsd: 0.021 },
  });
}

export const mockEngine: Engine = {
  name: "mock",
  run: ({ agentId, runId, prompt, emit }) => runScript(agentId, runId, prompt, emit),
  stop: () => {},
};
