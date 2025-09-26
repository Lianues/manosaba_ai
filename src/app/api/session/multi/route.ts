import { z } from 'zod';
import { getConfigFromRequest } from '@/lib/config';
import { QAItem, buildFinalPrompt, DEFAULT_INSTRUCTION } from '@/lib/prompt';
import { parseCharacterXml, composeProfilePrompt, CharacterXML } from '@/lib/xml';

export const runtime = 'nodejs';

const QaItemSchema = z.object({
  q: z.string().min(1, 'q required'),
  a: z.string().min(1, 'a required'),
});

const RoleSchema = z.object({
  roleId: z.string().min(1, 'roleId required'),
  roleName: z.string().min(1, 'roleName required'),
  qa: z.array(QaItemSchema).min(1, 'qa must have at least 1 item'),
});

const BodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId required'),
  roles: z.array(RoleSchema).min(1, 'roles must have at least 1 item'),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(8192).optional(),
  modelId: z.string().min(1).optional(),
});

type RoleResult = {
  roleId: string;
  roleName: string;
  text: string;
  model: string;
  finishReason?: string;
  usage?: unknown;
  extracted?: CharacterXML | null;
  extractedAppearance?: string;
  extractedPreferences?: string;
  composedProfilePrompt?: string;
};

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

    const { sessionId, roles, temperature, maxOutputTokens, modelId } = parsed.data;

    const cfg = await getConfigFromRequest(req);
    const baseURL = cfg.ai.baseURL;
    const model = modelId ?? cfg.ai.model;

    console.log('SESSION MULTI API 配置:', {
      baseURL,
      model,
      hasApiKey: !!cfg.ai.apiKey,
    });

    // For each role, build final prompt and call model
    const roleResults: RoleResult[] = [];

    for (const role of roles) {
      const { finalPrompt } = buildFinalPrompt(role.qa as QAItem[], DEFAULT_INSTRUCTION);

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

      console.log('SESSION MULTI API request payload (role):', role.roleId, payload);

      const response = await fetch(baseURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.ai.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const rawText = await response.clone().text();
      console.log('SESSION MULTI role raw response status:', role.roleId, response.status);
      console.log('SESSION MULTI role raw response body:', role.roleId, rawText);

      if (!response.ok) {
        // Continue but mark extracted null
        roleResults.push({
          roleId: role.roleId,
          roleName: role.roleName,
          text: '',
          model,
          finishReason: undefined,
          usage: undefined,
          extracted: null,
          extractedAppearance: undefined,
          extractedPreferences: undefined,
          composedProfilePrompt: undefined,
        });
        continue;
      }

      const result = await response.json();
      const choice = result?.choices?.[0];
      const text: string =
        choice?.message?.content ??
        choice?.text ??
        '';

      const extracted = parseCharacterXml(text);
      const composed = extracted ? composeProfilePrompt(extracted) : undefined;

      roleResults.push({
        roleId: role.roleId,
        roleName: role.roleName,
        text,
        model,
        finishReason: choice?.finish_reason,
        usage: result?.usage,
        extracted,
        extractedAppearance: extracted?.appearance,
        extractedPreferences: extracted?.preferences,
        composedProfilePrompt: composed,
      });
    }

    const allParsedOk = roleResults.every(r => !!r.extracted);

    const combinedProfilePrompt = roleResults
      .filter(r => r.composedProfilePrompt)
      .map(r => [`角色：${r.roleName}`, r.composedProfilePrompt!].join('\n'))
      .join('\n\n');

    return Response.json({
      ok: true,
      sessionId,
      model,
      roles: roleResults,
      parseOk: allParsedOk,
      combinedProfilePrompt: combinedProfilePrompt || undefined,
    });
  } catch (err: any) {
    console.error('SESSION MULTI API error:', err);
    return Response.json(
      { error: 'Internal Server Error', message: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}