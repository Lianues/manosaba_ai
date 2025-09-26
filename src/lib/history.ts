import type { FullOutlineXML, OutlineXML } from "@/lib/xml";

/**
 * 浏览器端（localStorage）的大纲历史存储工具。
 * 注意：需在“use client”组件里调用这些方法，服务端渲染阶段没有 window。
 */

export type OutlineHistoryEntry = {
  id: string;
  sessionId: string;
  protagonistName: string;
  createdAt: number;
  outlineXml: string;
  /** 生成大纲时的“人物提示词 XML”，用于从历史直接生成小节故事 */
  charactersXml?: string;
  title?: string;
  full?: FullOutlineXML | null;
  minimal?: OutlineXML | null;
};

export const OUTLINE_HISTORY_KEY = "manosaba_ai.outline_history";

export function loadOutlineHistory(): OutlineHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const s = window.localStorage.getItem(OUTLINE_HISTORY_KEY);
    if (!s) return [];
    const j = JSON.parse(s);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

export function saveOutlineToHistory(entry: OutlineHistoryEntry): void {
  if (typeof window === "undefined") return;
  try {
    const list = loadOutlineHistory();
    list.unshift(entry);
    window.localStorage.setItem(OUTLINE_HISTORY_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function clearOutlineHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(OUTLINE_HISTORY_KEY);
  } catch {
    // ignore
  }
}

export function getLatestOutline(): OutlineHistoryEntry | null {
  const list = loadOutlineHistory();
  return list.length > 0 ? list[0] : null;
}