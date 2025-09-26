import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const VALID_EXT = /\.(mp3|wav|ogg|m4a)$/i;

export async function GET() {
  try {
    const dir = path.join(process.cwd(), "public", "music");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && VALID_EXT.test(e.name))
      .map((e) => e.name);
    return NextResponse.json(files);
  } catch {
    // 目录不存在或读取失败，返回空数组
    return NextResponse.json([]);
  }
}