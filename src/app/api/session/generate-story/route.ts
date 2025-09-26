import { z } from 'zod';
import { getConfigFromRequest } from '@/lib/config';
import { parseStoryXml } from '@/lib/xml';

export const runtime = 'nodejs';

const BodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId required'),
  composedWithOutline: z.string().min(1, 'composedWithOutline required'),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(8192).optional(),
  modelId: z.string().min(1).optional(),
});

const STORY_INSTRUCTION = '请基于上面的人物设定和故事大纲，创作一个完整的故事，输出标准 XML 块，格式如下：\\n<story>\\n  <title><![CDATA[...]]></title>\\n  <content><![CDATA[...]]></content>\\n</story>\\n要求：\\n- 仅输出上述 XML 块，不要额外文字/解释/Markdown/标签以外内容；\\n- 使用中文；\\n- title 为故事标题，10-30字；\\n- content 为完整故事内容，800-1500字，包含开头、发展、高潮、结尾；\\n- 严格按照人物设定和大纲节拍展开情节；\\n- 如需包含特殊符号，请置于 CDATA 中。';

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

    const { sessionId, composedWithOutline, temperature, maxOutputTokens, modelId } = parsed.data;
    
    // 构造故事生成提示词
    const finalPrompt = `${composedWithOutline}\n\n${STORY_INSTRUCTION}`;

    const cfg = await getConfigFromRequest(req);
    const baseURL = cfg.ai.baseURL;
    const model = modelId ?? cfg.ai.model;

    console.log('STORY API 配置:', {
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
    console.log('STORY API request payload:', payload);

    const response = await fetch(baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.ai.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.clone().text();
    console.log('STORY API raw response status:', response.status);
    console.log('STORY API raw response body:', rawText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      return Response.json(
        { error: 'AI API Error', status: response.status, message: errorText },
        { status: 502 }
      );
    }

    const result = await response.json();
    console.log('STORY API parsed json:', result);
    const choice = result?.choices?.[0];
    const text: string = choice?.message?.content ?? choice?.text ?? '';

    const extractedStory = parseStoryXml(text);

    return Response.json({
      ok: true,
      sessionId,
      model,
      text,
      usage: result?.usage,
      parseOk: !!extractedStory,
      extractedTitle: extractedStory?.title,
      extractedContent: extractedStory?.content,
      finalStory: extractedStory,
    });
  } catch (err: any) {
    console.error('STORY API error:', err);
    return Response.json(
      { error: 'Internal Server Error', message: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}