// Server-only provider-agnostic AI layer.
//
// Replaces the hard dependency on the Lovable AI gateway (only auto-configured
// on Lovable-hosted deploys). Provider is chosen from the environment:
//   ANTHROPIC_API_KEY → Claude via the official @anthropic-ai/sdk (claude-opus-4-8)
//   GEMINI_API_KEY    → Gemini via Google's OpenAI-compatible endpoint
//   LOVABLE_API_KEY   → Lovable AI gateway (OpenAI-compatible), legacy fallback
//
// Callers speak one normalized OpenAI-flavored shape (messages / tools /
// tool_calls) because that's what the existing routes were written against;
// the Anthropic branch adapts it to the native Messages API via the SDK.

import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_TOKENS = 4096;

export type AIProvider = "anthropic" | "gemini" | "lovable";

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
}

/**
 * Strip anything that isn't a printable-ASCII key character. API keys are
 * always plain ASCII (letters, digits, `-`/`_`), so this removes paste
 * corruption — surrounding whitespace/newlines, a BOM, zero-width spaces,
 * smart quotes, or an ellipsis accidentally copied from abbreviated text —
 * without ever altering a valid key. Prevents fetch's "Cannot convert to
 * ByteString" when the Authorization/x-api-key header is built.
 */
export function cleanKey(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/[^\x21-\x7E]/g, "");
}

export function getAI(): AIConfig | null {
  const anthropic = cleanKey(process.env.ANTHROPIC_API_KEY);
  if (anthropic) {
    return {
      provider: "anthropic",
      apiKey: anthropic,
      model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
    };
  }
  const gemini = cleanKey(process.env.GEMINI_API_KEY);
  if (gemini) {
    return {
      provider: "gemini",
      apiKey: gemini,
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    };
  }
  const lovable = cleanKey(process.env.LOVABLE_API_KEY);
  if (lovable) {
    return {
      provider: "lovable",
      apiKey: lovable,
      model: process.env.LOVABLE_MODEL || "google/gemini-3-flash-preview",
    };
  }
  return null;
}

// ── Normalized chat shape (OpenAI-flavored, matches existing call sites) ────

export type AIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type AIChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AIToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export interface AIToolDef {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface AIChatOptions {
  messages: AIChatMessage[];
  tools?: AIToolDef[];
  /** "auto" (default when tools present) or force a specific tool by name. */
  toolChoice?: "auto" | { name: string };
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AIChatResult {
  content: string | null;
  toolCalls: AIToolCall[];
}

export async function aiChat(ai: AIConfig, opts: AIChatOptions): Promise<AIChatResult> {
  if (ai.provider === "anthropic") return anthropicChat(ai, opts);
  return openAICompatChat(ai, opts);
}

/** One-shot text helper for simple prompts (pitch angles, briefings). */
export async function aiText(
  ai: AIConfig,
  args: { system: string; user: string; maxTokens?: number; timeoutMs?: number },
): Promise<string | null> {
  const { content } = await aiChat(ai, {
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    maxTokens: args.maxTokens,
    timeoutMs: args.timeoutMs,
  });
  return content?.trim() || null;
}

/**
 * Structured-output helper: forces one tool call and returns its parsed
 * arguments. Used for call scripts and call summaries.
 */
export async function aiExtract<T>(
  ai: AIConfig,
  args: {
    system: string;
    user: string;
    toolName: string;
    toolDescription: string;
    schema: Record<string, unknown>;
    timeoutMs?: number;
  },
): Promise<T | null> {
  const { toolCalls } = await aiChat(ai, {
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: args.toolName,
          description: args.toolDescription,
          parameters: args.schema,
        },
      },
    ],
    toolChoice: { name: args.toolName },
    timeoutMs: args.timeoutMs,
  });
  const raw = toolCalls[0]?.function.arguments;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── Anthropic branch (official SDK, native Messages API) ────────────────────

function toAnthropicMessages(messages: AIChatMessage[]): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const systemParts: string[] = [];
  const out: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments || "{}");
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      if (blocks.length) out.push({ role: "assistant", content: blocks });
      continue;
    }
    if (m.role === "tool") {
      // Tool results land inside a user turn. Parallel tool results must be
      // in ONE user message, so merge consecutive tool messages.
      const block: Anthropic.ContentBlockParam = {
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content: m.content,
      };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as Anthropic.ContentBlockParam[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return { system: systemParts.join("\n\n"), messages: out };
}

async function anthropicChat(ai: AIConfig, opts: AIChatOptions): Promise<AIChatResult> {
  const client = new Anthropic({
    apiKey: ai.apiKey,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const { system, messages } = toAnthropicMessages(opts.messages);

  const tools: Anthropic.ToolUnion[] | undefined = opts.tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));

  const tool_choice: Anthropic.ToolChoice | undefined = !tools
    ? undefined
    : opts.toolChoice && opts.toolChoice !== "auto"
      ? { type: "tool", name: opts.toolChoice.name }
      : { type: "auto" };

  const response = await client.messages.create({
    model: ai.model,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(system ? { system } : {}),
    messages,
    ...(tools ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
  });

  const textParts: string[] = [];
  const toolCalls: AIToolCall[] = [];
  for (const block of response.content) {
    if (block.type === "text") textParts.push(block.text);
    else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  return { content: textParts.length ? textParts.join("") : null, toolCalls };
}

// ── OpenAI-compatible branch (Gemini compat endpoint + Lovable gateway) ─────

function compatEndpoint(provider: AIProvider): string {
  return provider === "gemini"
    ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";
}

async function openAICompatChat(ai: AIConfig, opts: AIChatOptions): Promise<AIChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model: ai.model,
      messages: opts.messages,
    };
    if (opts.tools) {
      body.tools = opts.tools;
      body.tool_choice =
        opts.toolChoice && opts.toolChoice !== "auto"
          ? { type: "function", function: { name: opts.toolChoice.name } }
          : "auto";
    }
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;

    const res = await fetch(compatEndpoint(ai.provider), {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`AI ${ai.provider} ${res.status}: ${t.slice(0, 300)}`);
    }
    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: AIToolCall[] } }>;
    };
    const msg = j?.choices?.[0]?.message;
    return { content: msg?.content ?? null, toolCalls: msg?.tool_calls ?? [] };
  } finally {
    clearTimeout(timer);
  }
}
