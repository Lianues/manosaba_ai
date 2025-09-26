import { z } from 'zod';
import { getConfigFromRequest } from '@/lib/config';
import { parseStoryXml } from '@/lib/xml';

export const runtime = 'nodejs';

const BodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId required'),
  rawPrompt: z.string().min(1, 'rawPrompt required'),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(8192).optional(),
  modelId: z.string().min(1).optional(),
});

/**
 * 以“原始拼接提示词”(rawPrompt) 直接生成某一节的故事片段。
 * rawPrompt 请在前端组合：
 * 世界书XML + 人物XML + 大纲完整XML + 上一节提示(首节空) + 生成故事提示词.md(替换 {{mainCharacter}} 和 {{sectionTitle}})
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

    const { sessionId, rawPrompt, temperature, maxOutputTokens, modelId } = parsed.data;

    const cfg = await getConfigFromRequest(req);
    const baseURL = cfg.ai.baseURL;
    const model = modelId ?? cfg.ai.model;

    console.log('SECTION STORY API 配置:', {
      baseURL,
      model,
      hasApiKey: !!cfg.ai.apiKey,
    });

    const payload = {
      model,
      messages: [
        {
          role: 'user',
          content: rawPrompt,
        },
      ],
      temperature: temperature ?? 1.0,
      max_tokens: maxOutputTokens,
      stream: false,
    };
    console.log('SECTION STORY API request payload:', { sessionId, payloadPreview: { model, temperature: payload.temperature, max_tokens: payload.max_tokens } });

    const response = await fetch(baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.ai.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.clone().text();
    console.log('SECTION STORY API raw response status:', response.status);
    console.log('SECTION STORY API raw response body:', rawText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      return Response.json(
        { error: 'AI API Error', status: response.status, message: errorText },
        { status: 502 }
      );
    }

    const result = await response.json();
    const choice = result?.choices?.[0];
    const text: string = choice?.message?.content ?? choice?.text ?? '';

    const parsedStory = parseStoryXml(text);
    const parseOk = !!parsedStory;

    return Response.json({
      ok: true,
      sessionId,
      model,
      text,
      parseOk,
      finalStory: parsedStory ?? undefined,
      finishReason: choice?.finish_reason,
      usage: result?.usage,
    });
  } catch (err: any) {
    console.error('SECTION STORY API error:', err);
    return Response.json(
      { error: 'Internal Server Error', message: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}