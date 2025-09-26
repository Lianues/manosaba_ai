import { z } from 'zod';
import { getConfigFromRequest } from '@/lib/config';
import { QAItem, buildFinalPrompt, DEFAULT_INSTRUCTION } from '@/lib/prompt';
import { parseCharacterXml, composeProfilePrompt } from '@/lib/xml';

export const runtime = 'nodejs';

type StoredSession = {
  sessionId: string;
  qa: QAItem[];
  promptOnly: string;
  appendInstruction: string;
  finalPrompt: string;
  templateName?: string;
  templateRaw?: string;
  output?: {
    text: string;
    model: string;
    finishReason?: string;
    usage?: unknown;
    raw?: unknown;
  };
  extractedXml?: {
    appearance: string;
    preferences: string;
  };
  composedProfilePrompt?: string;
  updatedAt: number;
};

const store = new Map<string, StoredSession>();

const QaItemSchema = z.object({
  q: z.string().min(1, 'q required'),
  a: z.string().min(1, 'a required'),
});

const BodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId required'),
  qa: z.array(QaItemSchema).min(1, 'qa must have at least 1 item'),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(8192).optional(),
  modelId: z.string().min(1).optional(), // 可选覆盖模型
});

/**
 * 提示词构建逻辑已集中到 '@/lib/prompt' 的 buildFinalPrompt
 * 这里不再维护本地版本，避免多处修改。
 */

export async function POST(req: Request): Promise<Response> {
  try {
    const json = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionId, qa, temperature, maxOutputTokens, modelId } = parsed.data;
    const { promptOnly, finalPrompt, templateName, templateRaw } = buildFinalPrompt(qa, DEFAULT_INSTRUCTION);

    // 先保存会话（不含输出）
    const initial: StoredSession = {
      sessionId,
      qa,
      promptOnly,
      appendInstruction: DEFAULT_INSTRUCTION,
      finalPrompt,
      templateName,
      templateRaw,
      updatedAt: Date.now(),
    };
    store.set(sessionId, initial);

    // 直接使用持久化文件中的完整 chat/completions URL
    const cfg = await getConfigFromRequest(req);
    const baseURL = cfg.ai.baseURL; // 期望为 https://openrouter.ai/api/v1/chat/completions
    const model = modelId ?? cfg.ai.model;

    // 日志便于排查
    console.log('SESSION API 配置:', {
      baseURL,
      model,
      hasApiKey: !!cfg.ai.apiKey,
    });

    const payload = {
      model,
      messages: [
        {
          role: 'user',
          content: finalPrompt,
        },
      ],
      temperature: temperature ?? 1.0,
      max_tokens: maxOutputTokens,
      stream: false,
    };
    console.log('SESSION API request payload:', payload);

    const response = await fetch(baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.ai.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.clone().text();
    console.log('SESSION API raw response status:', response.status);
    console.log('SESSION API raw response body:', rawText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      return Response.json(
        { error: 'AI API Error', status: response.status, message: errorText },
        { status: 502 }
      );
    }

    const result = await response.json();
    console.log('SESSION API parsed json:', result);

    // OpenAI/OR 标准响应解析
    const choice = result?.choices?.[0];
    const text: string =
      choice?.message?.content ??
      choice?.text ??
      '';

    const extracted = parseCharacterXml(text);
    const composedPrompt = extracted ? composeProfilePrompt(extracted) : undefined;

    const stored = store.get(sessionId);
    const finalStored: StoredSession = {
      ...(stored ?? initial),
      output: {
        text,
        model,
        finishReason: choice?.finish_reason,
        usage: result?.usage,
        raw: result,
      },
      extractedXml: extracted || undefined,
      composedProfilePrompt: composedPrompt,
      updatedAt: Date.now(),
    };
    store.set(sessionId, finalStored);

    return Response.json({
      ok: true,
      sessionId,
      model,
      text,
      usage: result?.usage,
      parseOk: !!extracted,
      extractedAppearance: extracted?.appearance,
      extractedPreferences: extracted?.preferences,
      composedProfilePrompt: composedPrompt,
    });
  } catch (err: any) {
    console.error('SESSION API error:', err);
    return Response.json(
      { error: 'Internal Server Error', message: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/session?sessionId=xxx
 * 读取已存储的会话（问答汇总、最终提示词与上次输出）
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('sessionId') ?? '';
    if (!sessionId) {
      return Response.json({ error: 'sessionId required' }, { status: 400 });
    }
    const data = store.get(sessionId);
    if (!data) {
      return Response.json({ error: 'not found', sessionId }, { status: 404 });
    }
    return Response.json({
      ok: true,
      sessionId,
      qa: data.qa,
      promptOnly: data.promptOnly,
      finalPrompt: data.finalPrompt,
      templateName: data.templateName,
      templateRaw: data.templateRaw,
      extractedXml: data.extractedXml,
      composedProfilePrompt: data.composedProfilePrompt,
      output: data.output,
      updatedAt: data.updatedAt,
    });
  } catch (err: any) {
    console.error('SESSION GET error:', err);
    return Response.json(
      { error: 'Internal Server Error', message: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}