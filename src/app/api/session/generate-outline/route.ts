import { z } from 'zod';
import { getConfigFromRequest } from '@/lib/config';
import { parseStoryOutlineXml, composeOutlineAppendPrompt, parseFullStoryOutlineXml, FullOutlineChapter, FullOutlineSection } from '@/lib/xml';

// 配置为静态导出
export const dynamic = "force-static";
export const runtime = 'nodejs';

const BodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId required'),
  profilePrompt: z.string().min(1).optional(),
  rawPrompt: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(8192).optional(),
  modelId: z.string().min(1).optional(),
});

const OUTLINE_INSTRUCTION = '请基于上面的人物设定，输出一个故事大纲的标准 XML 块，格式如下：\\n<storyOutline>\\n  <premise><![CDATA[...]]></premise>\\n  <beats>\\n    <beat><![CDATA[...]]></beat>\\n    <beat><![CDATA[...]]></beat>\\n    <beat><![CDATA[...]]></beat>\\n  </beats>\\n</storyOutline>\\n要求：\\n- 仅输出上述 XML 块，不要额外文字/解释/Markdown/标签以外内容；\\n- 使用中文；\\n- premise 描述故事前提/背景设定，50-100字；\\n- beats 包含3-5个故事节拍，每个beat描述一个关键情节点，30-80字；\\n- 如需包含特殊符号，请置于 CDATA 中。';

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

    const { sessionId, profilePrompt, rawPrompt, temperature, maxOutputTokens, modelId } = parsed.data;
    
    // 构造大纲生成提示词
    const finalPrompt = rawPrompt && rawPrompt.trim().length > 0
      ? rawPrompt
      : `${profilePrompt}\n\n${OUTLINE_INSTRUCTION}`;

    const cfg = await getConfigFromRequest(req);
    const baseURL = cfg.ai.baseURL;
    const model = modelId ?? cfg.ai.model;

    console.log('OUTLINE API 配置:', {
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
    console.log('OUTLINE API request payload:', payload);

    const response = await fetch(baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.ai.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.clone().text();
    console.log('OUTLINE API raw response status:', response.status);
    console.log('OUTLINE API raw response body:', rawText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      return Response.json(
        { error: 'AI API Error', status: response.status, message: errorText },
        { status: 502 }
      );
    }

    const result = await response.json();
    console.log('OUTLINE API parsed json:', result);
    const choice = result?.choices?.[0];
    const text: string = choice?.message?.content ?? choice?.text ?? '';

    const fullOutline = parseFullStoryOutlineXml(text);
    const extractedOutline = fullOutline ? null : parseStoryOutlineXml(text);
    const composedWithOutline = extractedOutline && !rawPrompt
      ? composeOutlineAppendPrompt(profilePrompt!, extractedOutline)
      : undefined;

    return Response.json({
      ok: true,
      sessionId,
      model,
      text,
      usage: result?.usage,
      parseOk: !!(fullOutline || extractedOutline),
      extractedPremise: fullOutline?.premise ?? extractedOutline?.premise,
      extractedBeats: fullOutline
        ? (fullOutline.chapters as FullOutlineChapter[]).flatMap(
            (ch: FullOutlineChapter) =>
              (ch.sections as FullOutlineSection[]).map((s: FullOutlineSection) => s.summary)
          )
        : extractedOutline?.beats,
      composedWithOutline,
    });
  } catch (err: unknown) {
    console.error('OUTLINE API error:', err);
    return Response.json(
      { error: 'Internal Server Error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}