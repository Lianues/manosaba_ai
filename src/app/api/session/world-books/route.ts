import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export const runtime = 'nodejs';

type Node = { type: 'folder' | 'file'; name: string; children?: Node[]; content?: string };

function cdata(s: string): string {
  const safe = (s ?? '').replace(/\]\]>/g, ']]]]><![CDATA[>');
  return `<![CDATA[${safe}]]>`;
}

async function buildTree(absDir: string, relName: string): Promise<Node> {
  const dirNode: Node = { type: 'folder', name: relName, children: [] };
  const entries = await readdir(absDir, { withFileTypes: true });
  // 稳定输出：按名字排序
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  for (const e of entries) {
    const absPath = join(absDir, e.name);
    if (e.isDirectory()) {
      const child = await buildTree(absPath, e.name);
      dirNode.children!.push(child);
    } else if (e.isFile()) {
      let content = '';
      try {
        content = await readFile(absPath, 'utf-8');
      } catch {
        // 跳过不可读文件
        content = '';
      }
      dirNode.children!.push({ type: 'file', name: e.name, content });
    }
  }
  return dirNode;
}

function renderXml(node: Node, indent = ''): string {
  const pad = (s: string) => s.split('\n').map((l) => indent + l).join('\n');
  if (node.type === 'folder') {
    const nameTag = `<name>${cdata(node.name)}</name>`;
    const childrenXml = (node.children ?? [])
      .map((ch) => renderXml(ch, indent + '  '))
      .join('\n');
    const body = [pad(nameTag), childrenXml ? childrenXml : ''].filter(Boolean).join('\n');
    return `${indent}<folder>\n${body}\n${indent}</folder>`;
  } else {
    const nameTag = `<name>${cdata(node.name)}</name>`;
    const contentTag = `<content>${cdata(node.content ?? '')}</content>`;
    const body = [pad(nameTag), pad(contentTag)].join('\n');
    return `${indent}<file>\n${body}\n${indent}</file>`;
  }
}

export async function GET(_req: Request): Promise<Response> {
  try {
    const baseDir = join(process.cwd(), 'game', 'world_books');
    const root = await buildTree(baseDir, 'world_books');
    const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<worldBooks>', renderXml(root, '  '), '</worldBooks>'].join('\n');
    return new Response(xml, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  } catch (err: any) {
    return Response.json({ error: 'Failed to read world_books', message: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}