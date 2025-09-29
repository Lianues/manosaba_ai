import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';

// 配置为静态导出
export const dynamic = "force-static";
export const runtime = 'nodejs';

type EnvMap = Record<string, string>;

function parseDotEnv(content: string): EnvMap {
  const out: EnvMap = {};
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function stringifyEnv(map: EnvMap, original?: string): string {
  const knownKeys = new Set(Object.keys(map));
  const lines = (original ?? '').split(/\r?\n/);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    if (!raw) {
      result.push(raw);
      continue;
    }
    const line = raw;
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.indexOf('=') <= 0) {
      result.push(line);
      continue;
    }
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    if (knownKeys.has(key)) {
      const val = map[key] ?? '';
      result.push(`${key}=${val}`);
      seen.add(key);
    } else {
      result.push(line);
    }
  }
  // append new keys not seen
  for (const key of Object.keys(map)) {
    if (!seen.has(key)) {
      result.push(`${key}=${map[key] ?? ''}`);
    }
  }
  // ensure trailing newline
  return result.join('\n').replace(/\n?$/, '\n');
}

async function readEnvFile(): Promise<{ map: EnvMap; raw: string }> {
  const envPath = path.resolve(process.cwd(), '.env.local');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    return { map: parseDotEnv(raw), raw };
  } catch {
    return { map: {}, raw: '' };
  }
}

async function writeEnvFile(map: EnvMap, original: string): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const content = stringifyEnv(map, original);
  await fs.writeFile(envPath, content, 'utf8');
}

const UpdateSchema = z.object({
  AI_API_KEY: z.string().min(1).optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_MODEL_ID: z.string().min(1).optional(),
});

export async function GET(): Promise<Response> {
  try {
    const { map } = await readEnvFile();
    const env = {
      AI_API_KEY: map.AI_API_KEY ?? '',
      AI_BASE_URL: map.AI_BASE_URL ?? '',
      AI_MODEL_ID: map.AI_MODEL_ID ?? '',
    };
    return Response.json({ ok: true, env });
  } catch (err: unknown) {
    return Response.json(
      { error: 'Internal Server Error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { map, raw } = await readEnvFile();
    const next: EnvMap = { ...map };
    for (const key of ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL_ID'] as const) {
      const val = parsed.data[key];
      if (typeof val === 'string') {
        next[key] = val;
      }
    }
    await writeEnvFile(next, raw);
    const env = {
      AI_API_KEY: next.AI_API_KEY ?? '',
      AI_BASE_URL: next.AI_BASE_URL ?? '',
      AI_MODEL_ID: next.AI_MODEL_ID ?? '',
    };
    return Response.json({ ok: true, env });
  } catch (err: unknown) {
    return Response.json(
      { error: 'Internal Server Error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}