import { readFile } from 'fs/promises';
import { join } from 'path';

// 配置为静态导出
export const dynamic = "force-static";
export const runtime = 'nodejs';

/**
 * 返回 game/workflow/生成故事提示词.md 原始文本（不做替换）
 * 前端负责将 {{mainCharacter}} 与 {{sectionTitle}} 替换为主人公与目标小节标题。
 */
export async function GET(): Promise<Response> {
  try {
    const filePath = join(process.cwd(), 'game', 'workflow', '生成故事提示词.md');
    const text = await readFile(filePath, 'utf-8');
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err: unknown) {
    return Response.json(
      { error: 'Failed to read story prompt', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}