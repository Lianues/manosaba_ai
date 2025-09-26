import { z } from 'zod';

/**
 * 浏览器端配置优先策略：后端仅从请求头读取 AI 配置，不再读取 .env 或进程环境。
 * 必须提供以下请求头：
 * - x-ai-api-key
 * - x-ai-base-url
 * - x-ai-model-id
 */
const EnvSchema = z.object({
  AI_API_KEY: z.string().min(1, 'AI_API_KEY is required'),
  AI_BASE_URL: z.string().url('AI_BASE_URL must be a valid URL'),
  AI_MODEL_ID: z.string().min(1, 'AI_MODEL_ID is required'),
});

export async function getConfigFromRequest(req: Request) {
  const headers = req.headers;
  const hApiKey = headers.get('x-ai-api-key') || '';
  const hBaseURL = headers.get('x-ai-base-url') || '';
  const hModelId = headers.get('x-ai-model-id') || '';

  const raw = {
    AI_API_KEY: hApiKey,
    AI_BASE_URL: hBaseURL,
    AI_MODEL_ID: hModelId,
  };

  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const missing: string[] = [];
    if (!hApiKey) missing.push('x-ai-api-key');
    if (!hBaseURL) missing.push('x-ai-base-url');
    if (!hModelId) missing.push('x-ai-model-id');
    const detail = JSON.stringify(parsed.error.flatten().fieldErrors);
    throw new Error(`Invalid AI config headers. Missing: ${missing.join(', ') || 'none'}. Details: ${detail}`);
  }

  return {
    ai: {
      apiKey: parsed.data.AI_API_KEY,
      baseURL: parsed.data.AI_BASE_URL,
      model: parsed.data.AI_MODEL_ID,
    },
  } as const;
}