import { z } from 'zod';
import { getConfigFromRequest } from '@/lib/config';
import { QAItem, buildFinalPrompt } from '@/lib/prompt';
import { readFile } from 'fs/promises';
import { join } from 'path';

// 配置为静态导出
export const dynamic = "force-static";
export const runtime = 'nodejs';

// Body schema
const QaItemSchema = z.object({
  q: z.string().min(1, 'q required'),
  a: z.string().min(1, 'a required'),
});

const BodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId required'),
  roleId: z.string().min(1, 'roleId required'),
  roleName: z.string().min(1, 'roleName required'),
  qa: z.array(QaItemSchema).min(1, 'qa must have at least 1 item'),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(8192).optional(),
  modelId: z.string().min(1).optional(),
});

// Minimal XML helpers (local to this route)
function stripCData(s: string): string {
  return s.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
}
function innerText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  return stripCData(m[1]).trim();
}

type CompletionExtracted = {
  name: string;
  age: string;
  appearanceClothes: string;
  magicPre: string;
  magicPost: string;
  tragicStory: string;
  personality: string;
  originalSin: string;
};

function parseCharacterCompletionXml(xml: string): CompletionExtracted | null {
  if (typeof xml !== 'string' || !xml.trim()) return null;
  // Narrow scope to root if present
  const rootMatch = xml.match(/<characterCompletion\b[^>]*>([\s\S]*?)<\/characterCompletion>/i);
  const scope = rootMatch ? rootMatch[1] : xml;

  const name = innerText(scope, 'name') ?? '';
  const age = innerText(scope, 'age') ?? '';
  const appearanceClothes = innerText(scope, 'appearanceClothes') ?? '';
  const magicPre = innerText(scope, 'pre') ?? '';
  const magicPost = innerText(scope, 'post') ?? '';
  const tragicStory = innerText(scope, 'tragicStory') ?? '';
  const personality = innerText(scope, 'personality') ?? '';
  const originalSin = innerText(scope, 'originalSin') ?? '';

  if (!name || !age || !appearanceClothes || !tragicStory || !personality || !originalSin) {
    return null;
  }
  return { name, age, appearanceClothes, magicPre, magicPost, tragicStory, personality, originalSin };
}

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

    const { sessionId, roleId, roleName, qa, temperature, maxOutputTokens, modelId } = parsed.data;

    const cfg = await getConfigFromRequest(req);
    const baseURL = cfg.ai.baseURL;
    const model = modelId ?? cfg.ai.model;

    // Read the character generation template
    const templatePath = join(process.cwd(), 'game', 'random', '人物生成.md');
    let characterTemplate = '';
    try {
      characterTemplate = await readFile(templatePath, 'utf-8');
    } catch (err) {
      console.warn('Could not read character template:', err);
      // Fallback to basic instruction if file not found
      characterTemplate = `任务：生成一个人物设定（女性，15-18岁），并以 XML 输出，字段如下：
- 姓名
- 年龄
- 外貌衣着
- 魔法（包括魔女化前的能力和魔女化后的能力）
- 悲惨故事
- 性格
- 原罪

XML 输出格式（严格）：
仅输出下列 XML，不要任何额外解释或文本，内容使用中文，必要符号置于 CDATA 中。
<characterCompletion>
  <name><![CDATA[女性姓名]]></name>
  <age><![CDATA[15-18岁之间的年龄]]></age>
  <appearanceClothes><![CDATA[外貌与衣着（黑暗哥特风格，50-120字）]]></appearanceClothes>
  <magic>
    <pre><![CDATA[魔女化前的能力（50-120字，具体细节）]]></pre>
    <post><![CDATA[魔女化后的能力（初期表现，50-120字，具体细节）]]></post>
  </magic>
  <tragicStory><![CDATA[与魔女化相关的黑暗残酷故事，体现心理创伤，80-200字]]></tragicStory>
  <personality><![CDATA[同时体现负面与正面性格，结合悲惨故事，3-8条或150字以内]]></personality>
  <originalSin><![CDATA[导致严重负面行为/杀人的根因（七宗罪或自定义，50-120字）]]></originalSin>
</characterCompletion>`;
    }

    // Build final prompt: user Q&A + character template
    const { finalPrompt } = buildFinalPrompt(qa as QAItem[], characterTemplate);

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

    console.log('SESSION COMPLETE-ROLE request payload:', { sessionId, roleId, roleName, payload });

    const response = await fetch(baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.ai.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.clone().text();
    console.log('SESSION COMPLETE-ROLE raw response status:', response.status);
    console.log('SESSION COMPLETE-ROLE raw response body:', rawText);

    if (!response.ok) {
      return Response.json({
        ok: false,
        sessionId,
        roleId,
        roleName,
        model,
        parseOk: false,
        error: `Model API error: ${response.status}`,
        text: '',
      }, { status: 502 });
    }

    const result = await response.json();
    const choice = result?.choices?.[0];
    const text: string =
      choice?.message?.content ??
      choice?.text ??
      '';

    const extracted = parseCharacterCompletionXml(text);
    const parseOk = !!extracted;

    return Response.json({
      ok: true,
      sessionId,
      roleId,
      roleName,
      model,
      text,
      parseOk,
      extracted: extracted ?? undefined,
      finishReason: choice?.finish_reason,
      usage: result?.usage,
    });
  } catch (err: unknown) {
    console.error('SESSION COMPLETE-ROLE API error:', err);
    return Response.json(
      { ok: false, error: 'Internal Server Error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}