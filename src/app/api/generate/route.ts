import { z } from 'zod';
import { getConfigFromRequest } from '@/lib/config';

export const runtime = 'nodejs';

const BodySchema = z.object({
  prompt: z.string().min(1, 'prompt is required'),
  maxOutputTokens: z.number().int().min(1).max(8192).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

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

    const cfg = await getConfigFromRequest(req);

    console.log('API 配置:', {
      baseURL: cfg.ai.baseURL,
      model: cfg.ai.model,
      hasApiKey: !!cfg.ai.apiKey
    });

    const response = await fetch(cfg.ai.baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.ai.model,
        messages: [
          {
            role: 'user',
            content: parsed.data.prompt
          }
        ],
        temperature: parsed.data.temperature ?? 1.0,
        max_tokens: parsed.data.maxOutputTokens,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
      return Response.json(
        { error: 'AI API Error', status: response.status, message: errorText },
        { status: 500 }
      );
    }

    const result = await response.json();
    
    return Response.json({
      ok: true,
      model: cfg.ai.model,
      text: result.choices[0]?.message?.content || '',
      finishReason: result.choices[0]?.finish_reason,
      usage: result.usage,
    });
  } catch (err: any) {
    console.error('Generate API error:', err);
    return Response.json(
      { error: 'Internal Server Error', message: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}