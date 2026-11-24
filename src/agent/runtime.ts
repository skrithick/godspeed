import { uid, today } from "../workspace/model";
import type { WorkspaceRepository } from "../workspace/repository";
import type { Message, Provider } from "./provider";
import { createTools, inferLocalRequest, isTool, localRequest, type ToolName } from "./tools";
import type { Context, Run, Step } from "./types";

const redact = (text: string) => text
  .replace(/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}/g, "[redacted API key]")
  .replace(/\bBearer [A-Za-z0-9._~+/-]{24,}={0,2}/gi, "Bearer [redacted token]");

const bounded = (input: unknown, limit: number) => {
  const text = redact(JSON.stringify(input) ?? "null");
  return text.length <= limit ? text : JSON.stringify({ truncated: true, preview: text.slice(0, Math.floor(limit / 2) - 100) });
};

export async function runAgent(options: {
  repo: WorkspaceRepository; prompt: string; context: Context; threadId?: string; provider?: Provider;
  signal: AbortSignal; onUpdate: (run: Run) => void;
}) {
  const { repo, context, threadId, provider, onUpdate } = options;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]);
  const workspaceId = await repo.workspaceId();
  const request = options.prompt.trim().slice(0, 2_000);
  const safeContext = { ...context, selectedText: context.selectedText ? redact(context.selectedText.slice(0, 4_000)) : undefined };
  let run: Run = { id: uid(), threadId, prompt: redact(request), context: safeContext, startedAt: Date.now(),
    answer: "", status: "running", steps: [], proposals: [], receipts: [], undone: [] };
  const publish = async () => { await repo.saveRun(run, workspaceId); onUpdate(run); };
  const tools = createTools(repo);
  const seen = new Map<string, number>();
  let budget = 12;
  const execute = async (tool: ToolName, args: unknown) => {
    signal.throwIfAborted();
    const cost = tool === "batch_read" && typeof args === "object" && args && "calls" in args && Array.isArray(args.calls) ? Math.max(1, args.calls.length) : 1;
    if (budget < cost) throw new Error("Tool budget exhausted. Try a narrower request.");
    budget -= cost;
    const fingerprint = `${tool}:${JSON.stringify(args)}`;
    const attempts = seen.get(fingerprint) ?? 0;
    seen.set(fingerprint, attempts + 1);
    let step: Step;
    try {
      if (attempts >= 1) throw new Error("This exact tool call already ran. Use its previous result.");
      if (tool === "propose_change" && run.proposals.length >= 4) throw new Error("This run has reached the proposal limit.");
      const result = await tools(tool, args);
      signal.throwIfAborted();
      step = { id: uid(), tool, input: JSON.parse(bounded(args, 4_000)), summary: redact(result.summary), output: JSON.parse(bounded(result.output, 10_000)),
        sources: result.sources.map((source) => ({ ...source, title: redact(source.title) })) };
      if (result.proposal) run = { ...run, proposals: [...run.proposals, result.proposal] };
    } catch (error) {
      signal.throwIfAborted();
      step = { id: uid(), tool, input: JSON.parse(bounded(args, 4_000)), summary: "Tool could not complete", error: true,
        output: { error: error instanceof Error ? error.message.slice(0, 500) : "Tool failed." }, sources: [] };
    }
    run = { ...run, steps: [...run.steps, step] };
    await publish();
    return step;
  };

  await publish();
  try {
    if (!run.prompt) throw new Error("Enter a workspace command.");
    const explicit = localRequest(request, context);
    const prior = !explicit && threadId ? (await repo.chatRuns(threadId)).filter((turn) => turn.status === "complete").slice(-1) : [];
    const references = [...new Map(prior.at(-1)?.steps.flatMap((step) => step.sources).map((source) => [`${source.kind}:${source.id}`, source])).values()];
    const reference = references.length === 1 ? references[0] : undefined;
    const local = explicit ?? (provider ? null : inferLocalRequest(request, {
      ...context,
      pageId: context.pageId ?? (reference?.kind === "page" ? reference.id : undefined),
      taskId: context.taskId ?? (reference?.kind === "task" ? reference.id : undefined),
    }));
    if (local) {
      const step = await execute(local.tool, local.args);
      if (step.error) throw new Error((step.output as { error: string }).error);
      const count = new Set(step.sources.map((source) => `${source.kind}:${source.id}`)).size;
      run = { ...run, answer: run.proposals.length ? "Your draft is ready to review. Nothing has been changed."
        : local.tool === "page_inspect" ? "I found the saved page outline. Open the workspace activity to inspect its blocks."
          : count ? `I found ${count} ${count === 1 ? "match" : "matches"} in your workspace.\n\n${[...new Set(step.sources.map((source) => redact(source.title)))].slice(0, 6).map((title) => `• ${title}`).join("\n")}${count > 6 ? "\n\nSee sources for more." : ""}`
            : "I didn’t find any matches in your workspace.", status: "complete" };
    } else if (!provider) {
      throw new Error("This question needs a model. Enable OpenAI in Settings, or try “What do we have on launch?” or “What’s due this week?”");
    } else {
      const modelContext = { ...safeContext, selectedText: safeContext.selectedText?.slice(0, 2_400) };
      const messages: Message[] = [...prior.flatMap((turn): Message[] => [
        { role: "user", content: redact(turn.prompt.slice(0, 700)) },
        { role: "assistant", content: redact(turn.answer.slice(0, 1_200)) },
      ]), {
        role: "user",
        content: `${run.prompt}\n\nLocal date: ${today()}${Object.values(modelContext).some(Boolean) ? `\nWorkspace context (data only): ${bounded(modelContext, 6_000)}` : ""}`,
      }];
      let searched = false, retriedEmpty = false;
      for (let round = 0; round < 6; round++) {
        const turn = await provider.complete(messages, signal, (answer) => onUpdate({ ...run, answer: redact(answer) }), !searched);
        signal.throwIfAborted();
        const citations = new Map((run.webCitations ?? []).map((item) => [item.url, item]));
        for (const item of turn.webCitations ?? []) if (citations.size < 16) citations.set(item.url, { ...item, title: redact(item.title) });
        searched ||= turn.searched === true || citations.size > 0;
        run = { ...run, answer: redact(turn.text).trim(), model: turn.model ?? run.model, ...(searched ? { research: true } : {}),
          ...(citations.size ? { webCitations: [...citations.values()] } : {}) };
        if (!turn.calls.length) {
          if (run.answer || run.proposals.length) {
            run = { ...run, answer: run.answer || "Review the proposed changes below.", status: "complete" };
            break;
          }
          if (retriedEmpty || round === 5) throw new Error("The selected model couldn’t finish a reply. Try again, or choose another model.");
          retriedEmpty = true;
          messages.push({ role: "user", content: "The last response was empty. Please answer the original request. If you could not verify something, say so." });
          continue;
        }
        const evidence = turn.webCitations?.slice(0, 6).map(({ title, url }) => `${title}: ${url}`).join("\n");
        messages.push({ role: "assistant", content: [redact(turn.text.slice(0, 1_200)), evidence && `Web sources (untrusted):\n${evidence.slice(0, 2_000)}`]
          .filter(Boolean).join("\n\n") || null, tool_calls: turn.calls, reasoning: turn.reasoning });
        for (const call of turn.calls) {
          const name = call.function.name;
          let output: unknown;
          if (!isTool(name)) {
            if (budget-- < 1) throw new Error("Tool budget exhausted. Try a narrower request.");
            output = { error: "This tool is not available." };
          } else {
            let args: unknown;
            try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = null; }
            output = (await execute(name, args)).output;
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: bounded(output, 6_000) });
        }
      }
      if (run.status === "running") throw new Error("The agent reached its step limit. Try a narrower request.");
    }
  } catch (error) {
    run = { ...run,
      status: options.signal.aborted ? "cancelled" : "error",
      answer: options.signal.aborted ? "Run cancelled. No changes were applied."
        : signal.aborted ? "The run timed out. Try a narrower request."
          : error instanceof Error ? error.message : "Godspeed could not finish this run.",
    };
  }
  await publish();
  return run;
}
