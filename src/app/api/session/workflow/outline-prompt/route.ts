import { readFile } from 'fs/promises';
import { join } from 'path';

export const runtime = 'nodejs';

/**
 * 返回 game/workflow/生成大纲提示词.md 原始文本（不做替换）
 * 前端负责将 {{mainCharacter}} 替换为已选择的主人公名称。
 */
export async function GET(_req: Request): Promise<Response> {
  try {
    const filePath = join(process.cwd(), 'game', 'workflow', '生成大纲提示词.md');
    const text = await readFile(filePath, 'utf-8');
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err: any) {
    return Response.json(
      { error: 'Failed to read outline prompt', message: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}