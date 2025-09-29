"use client";

export type LocalAIConfig = {
  apiKey: string;
  baseURL: string; // e.g. https://openrouter.ai/api/v1/chat/completions
  model: string;
};

export type ChatResult = {
  ok: boolean;
  text: string;
  model?: string;
  finishReason?: string;
  usage?: unknown;
  raw?: unknown;
  status?: number;
  message?: string;
};

function readLocalConfig(): Partial<LocalAIConfig> {
  try {
    const raw = localStorage.getItem("manosaba_ai.api_config");
    const cfg = raw ? JSON.parse(raw) : {};
    return {
      apiKey: cfg?.AI_API_KEY,
      baseURL: cfg?.AI_BASE_URL,
      model: cfg?.AI_MODEL_ID,
    };
  } catch {
    return {};
  }
}

function ensureConfig(overrides?: Partial<LocalAIConfig>): LocalAIConfig {
  const cfg = { ...readLocalConfig(), ...(overrides || {}) };
  const apiKey = (cfg.apiKey || "").trim();
  const baseURL = (cfg.baseURL || "").trim();
  const model = (cfg.model || "").trim();

  const missing: string[] = [];
  if (!apiKey) missing.push("AI_API_KEY");
  if (!baseURL) missing.push("AI_BASE_URL");
  if (!model) missing.push("AI_MODEL_ID");

  if (missing.length > 0) {
    throw new Error(`缺少前端配置：${missing.join(", ")}。请点击右上角“API 配置”按钮填写。`);
  }
  try {
    // 粗略校验 URL
    const u = new URL(baseURL);
    if (!u.protocol.startsWith("http")) throw new Error("invalid");
  } catch {
    throw new Error("AI_BASE_URL 非法，请填写完整的 chat/completions 接口 URL，例如：https://openrouter.ai/api/v1/chat/completions");
  }
  return { apiKey, baseURL, model };
}

/**
 * 直接在浏览器中调用 chat/completions
 * - 依赖跨域（CORS）放行；推荐使用允许浏览器直连的供应商（如 OpenRouter）
 * - 从 localStorage 读取 API Key/Base URL/Model ID
 */
export async function postChatCompletionsFromLocalConfig(
  prompt: string,
  opts?: {
    temperature?: number;
    maxTokens?: number;
    modelId?: string;
    overrides?: Partial<LocalAIConfig>; // 手动覆盖配置（调试用）
    signal?: AbortSignal;
  }
): Promise<ChatResult> {
  const { temperature, maxTokens, modelId, overrides, signal } = opts || {};
  const cfg = ensureConfig(overrides);
  const model = (modelId || cfg.model).trim();

  const payload: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature: number;
    max_tokens?: number;
    stream: boolean;
  } = {
    model,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: typeof temperature === "number" ? temperature : 1.0,
    max_tokens: typeof maxTokens === "number" ? maxTokens : undefined,
    stream: false,
  };

  let resp: Response | null = null;
  try {
    resp = await fetch(cfg.baseURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e: unknown) {
    // 典型为 CORS 或网络错误
    const msg =
      e instanceof Error
        ? e.message
        : "网络错误或浏览器被跨域策略阻止（CORS）。请确认供应商支持浏览器直连。";
    return { ok: false, text: "", status: 0, message: msg };
  }

  const status = resp.status;
  const rawText = await resp.clone().text();
  if (!resp.ok) {
    return {
      ok: false,
      text: "",
      status,
      message: rawText || `LLM API 调用失败，HTTP ${status}`,
      raw: rawText,
    };
  }

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    // 一些服务可能返回纯文本
    return {
      ok: true,
      text: rawText || "",
      model,
      raw: rawText,
      status,
    };
  }

  // 兼容 OpenAI/OpenRouter 风格
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const text: string =
    (message?.content as string) ??
    (choice?.text as string) ??
    (data.output_text as string) ??
    "";

  return {
    ok: true,
    text,
    model,
    finishReason: choice?.finish_reason as string | undefined,
    usage: data.usage,
    raw: data,
    status,
  };
}