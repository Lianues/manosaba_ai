"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseFullStoryOutlineXml, parseStoryOutlineXml, type FullOutlineXML, type OutlineXML } from "@/lib/xml";
import { saveOutlineToHistory, loadOutlineHistory, clearOutlineHistory, type OutlineHistoryEntry } from "../lib/history";

/**
 * 前端文字游戏 · 问卷 → 多阶段 AI 工作流 → 故事结果
 * 现已支持“多角色”的折叠/展开与“勾选生成”，每个角色独立问卷与属性 JSON。
 * 设计遵循 ui美化规范.md：
 * - 黑白极简、清晰层级、4/8pt 间距系统、响应式
 * - 细微阴影/圆角、微交互、触控友好尺寸
 */

type StageStatus = "idle" | "running" | "done" | "error";
type QAItem = { q: string; a: string };
type OutlineResp = {
  ok: boolean;
  text?: string;
  parseOk?: boolean;
  composedWithOutline?: string;
  extractedPremise?: string;
  extractedBeats?: string[];
};
type MultiSessionResp = {
  ok: boolean;
  parseOk?: boolean;
  combinedProfilePrompt?: string;
  roles?: Array<{
    roleId: string;
    roleName: string;
    text: string;
    extractedAppearance?: string;
    extractedPreferences?: string;
    composedProfilePrompt?: string;
  }>;
};
type StoryResp = {
  ok: boolean;
  parseOk?: boolean;
  finalStory?: { title: string; content: string };
  extractedTitle?: string;
  extractedContent?: string;
};


/** 用于前端内存中的“中文提示词”结构（不落盘） */
interface PromptCharacter {
  name: string;           // 姓名（女性）
  appearance: string;     // 外貌与衣着
  magic_pre: string;      // 魔女化前的能力
  magic_post: string;     // 魔女化后的能力
  tragic_story: string;   // 悲惨故事
  personality: string;    // 性格特质（正/负）
  original_sin: string;   // 原罪
}
interface PromptPayload {
  protagonistName: string;     // 主人公名称
  characters: PromptCharacter[]; // 13人（12选中 + 冰上 梅露露）
}

/** 最终发给 AI 的“中文键名”提示词结构 */
interface PromptCharacterCN {
  姓名: string;
  外貌与衣着: string;
  魔女化前的能力: string;
  魔女化后的能力: string;
  悲惨故事: string;
  性格特质: string;
  原罪: string;
}
interface PromptPayloadCN {
  主人公名称: string;
  人物列表: PromptCharacterCN[];
}

/** 从“魔法能力”自由文本里尽力解析“前/后”两段 */
function splitMagic(raw: string): { magic_pre: string; magic_post: string } {
  const t = (raw || "").trim();
  if (!t) return { magic_pre: "", magic_post: "" };

  // 1) 明确的“魔女化前/魔女化后”标记
  {
    const m = t.match(/魔女化?前[:：]\s*([\s\S]*?)(?:魔女化?后[:：]\s*([\s\S]*))?$/);
    if (m) {
      return {
        magic_pre: (m[1] || "").trim(),
        magic_post: (m[2] || "").trim(),
      };
    }
  }
  // 2) 简写“前/后”
  {
    const m = t.match(/(?:^|[\n\s])前[:：]\s*([\s\S]*?)(?:[\n\s]后[:：]\s*([\s\S]*))?$/);
    if (m) {
      return {
        magic_pre: (m[1] || "").trim(),
        magic_post: (m[2] || "").trim(),
      };
    }
  }
  // 3) 分隔符尝试：以换行、竖线、斜杠分成两段
  {
    const byLine = t.split(/\n{2,}|\n|\|+|\/+/).map(s => s.trim()).filter(Boolean);
    if (byLine.length >= 2) {
      return { magic_pre: byLine[0], magic_post: byLine.slice(1).join("；") };
    }
  }
  // 兜底：无法分割时，全部给到“前”，后为空
  return { magic_pre: t, magic_post: "" };
}

/** 将 UI 的 RoleForm → PromptCharacter（中文字段） */
function mapRoleToPromptCharacter(role: RoleForm): PromptCharacter {
  const get = (id: string) => role.questions.find(q => q.id === id)?.a?.trim() ?? "";
  const name = get("q1") || role.roleName.trim();
  const appearance = get("q3");
  const { magic_pre, magic_post } = splitMagic(get("q4"));
  const tragic_story = get("q5");
  const personality = get("q6");
  const original_sin = get("q7");

  return { name, appearance, magic_pre, magic_post, tragic_story, personality, original_sin };
}

/** 固定第13人：冰上 梅露露（根据补充设定提炼为六字段，中文值） */
function getMeruruCharacter(): PromptCharacter {
  return {
    name: "冰上 梅露露",
    appearance:
      "白发灰瞳的纤细少女，身高约158cm。常独处、神情怯弱，稍受刺激便泪如雨下。" +
      "喜静、爱阅读，擅长设计监狱内各类个性化物品（衣服、手机壳等）（梅露露不会透露是她设计的，少女们醒来就发现已经有这些东西了）。举止克制而敏感，" +
      "常以近乎要哭的表情示人，时常在意自己是否做错、是否伤到他人。",
    magic_pre:
      "『治愈』——使目标回到过去的状态：可瞬时治疗身体伤势，并修复被破坏的无机物与尸体；" +
      "但无法逆转死亡、使人复生。对“魔女化”具有一定的缓解或轻微降低作用。",
    magic_post:
      "能力进一步强化，连“心理创伤”亦可被治愈与抚平，治愈的深度与范围显著提升。",
    tragic_story:
      "曾是大魔女“月代雪”收养的人类试验品，被用于测试“魔女因子”。她并未变为残骸且仍保有人形，" +
      "被视为失败作；却也因此寿命极长、几近不死（除特定药物外不可杀）。大魔女离开后，她将其视作唯一的家人，" +
      "执念般地追寻其踪迹；在人类高层操纵下成为监狱的实际管理者与典狱长的主人，暗中推动“魔女审判”。" +
      "她误以为以少女们相互残杀与绝望加深魔女化，就能从中找回大魔女，因而甘愿背负‘幕后黑手’之名；" +
      "她也知晓“魔女安息仪式”的方法，却长久无法令良心跨过需要‘13名活着的魔女’的门槛。" +
      "她把自己当作‘魔女’的一分子，并始终以为自己承接了‘魔女杀手’之力——这份信念既支撑她，也吞噬她。",
    personality:
      "过度忧虑、敏感自责、对他人有发自内心的尊敬；对自身消极并伴随自虐倾向。" +
      "一旦在意某人会下意识尾随、躲在暗处观察；喜独处与阅读，情绪脆弱却又强迫自己背负“正确”的重担。",
    original_sin:
      "爱欲——对“大魔女”的执念与依恋凌驾于一切之上，以他人的痛苦与绝望换取一次“重逢”的可能。",
  };
}

// CDATA 包裹，避免特殊符号造成解析错误
function cdata(s: string): string {
  const t = (s || "").replace(/\]\]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${t}]]>`;
}

// 将“中文键名的人物列表”转为 XML 字符串（不使用 JSON）
function buildCharactersXml(protagonistName: string, list: PromptCharacterCN[]): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<人物提示词>');
  lines.push(`  <主人公名称>${cdata(protagonistName)}</主人公名称>`);
  lines.push('  <人物列表>');
  for (const c of list) {
    lines.push('    <人物>');
    lines.push(`      <姓名>${cdata(c.姓名)}</姓名>`);
    lines.push(`      <外貌与衣着>${cdata(c.外貌与衣着)}</外貌与衣着>`);
    lines.push(`      <魔女化前的能力>${cdata(c.魔女化前的能力)}</魔女化前的能力>`);
    lines.push(`      <魔女化后的能力>${cdata(c.魔女化后的能力)}</魔女化后的能力>`);
    lines.push(`      <悲惨故事>${cdata(c.悲惨故事)}</悲惨故事>`);
    lines.push(`      <性格特质>${cdata(c.性格特质)}</性格特质>`);
    lines.push(`      <原罪>${cdata(c.原罪)}</原罪>`);
    lines.push('    </人物>');
  }
  lines.push('  </人物列表>');
  lines.push('</人物提示词>');
  return lines.join('\n');
}

type UIQuestion = {
  id: string;
  q: string;
  a: string;
  fixed?: boolean; // 固定题不可删除
  placeholder?: string;
};

const DEFAULT_QUESTIONS: UIQuestion[] = [
  {
    id: "q1",
    q: "角色的姓名（女性）",
    a: "",
    fixed: true,
    placeholder: "例：希罗，请确保为女性姓名且不使用：梅露露/冰上梅露露/冰上 梅露露",
  },
  {
    id: "q2",
    q: "角色的年龄（15-18岁）",
    a: "",
    fixed: true,
    placeholder: "例：16岁，必须在15-18岁范围内",
  },
  {
    id: "q3",
    q: "请描述角色的外貌与衣着",
    a: "",
    fixed: true,
    placeholder: "例：银白长发、浅蓝眼；制服外披灰色披风。细节描写",
  },
  {
    id: "q4",
    q: "角色的魔法能力（包括魔女化前与魔女化后的能力）",
    a: "",
    fixed: true,
    placeholder: "例：魔女化前：掌心凝结薄冰；魔女化后：寒霜领域、可冻结大片空间",
  },
  {
    id: "q5",
    q: "角色的悲惨故事（关键事件与情感）",
    a: "",
    fixed: true,
    placeholder: "例：童年失去亲人、被误判囚禁、重要转折与心境变化",
  },
  {
    id: "q6",
    q: "请给出角色的性格特质（包括正面和负面）",
    a: "",
    fixed: true,
    placeholder: "例：极致的自我厌恶，敏锐的观察力",
  },
  {
    id: "q7",
    q: "角色的原罪",
    a: "",
    fixed: true,
    placeholder: "例：渴望被聆听",
  },
];

function cls(...xs: Array<string | false | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[28px] leading-[36px] font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function SpinnerDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cls(
        "inline-block h-2 w-2 rounded-full border",
        active ? "bg-black border-black animate-pulse" : "bg-transparent border-black/40"
      )}
    />
  );
}

// --- 本页内联：通用复制/下载工具（用于大纲历史卡片） ---
function copyText(text: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
  } catch {}
}

function downloadText(filename: string, text: string) {
  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch {}
}

// --- 本页内联：大纲历史卡片（从 /outline-history 迁移到首页内联展示） ---
function OutlineCard({ entry, onLoad, onCreateSection }: { entry: OutlineHistoryEntry; onLoad?: (e: OutlineHistoryEntry) => void; onCreateSection?: (entry: OutlineHistoryEntry, chIdx: number, secIdx: number, sectionTitle: string) => void }) {
  const [showXml, setShowXml] = useState(false);
  const [showParsed, setShowParsed] = useState(false);

  const parsed = useMemo(() => {
    const full: FullOutlineXML | null = parseFullStoryOutlineXml(entry.outlineXml);
    const minimal: OutlineXML | null = full ? null : parseStoryOutlineXml(entry.outlineXml);
    return { full, minimal };
  }, [entry.outlineXml]);

  const created = new Date(entry.createdAt);
  const createdLabel = isNaN(created.getTime())
    ? String(entry.createdAt)
    : `${created.toLocaleDateString()} ${created.toLocaleTimeString()}`;

  return (
    <div className="border border-black/12 p-4 my-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] leading-[24px] font-semibold">
            {entry.title || "未命名大纲"}
          </p>
          <p className="text-[13px] leading-[18px] text-black/60 mt-1">
            主人公：{entry.protagonistName} · 时间：{createdLabel} · 会话：{entry.sessionId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onLoad && (
            <button
              type="button"
              onClick={() => onLoad(entry)}
              className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
              title="载入此大纲到主界面用于逐节创作"
            >
              载入此大纲
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowXml((v) => !v)}
            className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
            title="查看原始 XML 文本"
          >
            {showXml ? "隐藏XML" : "查看XML"}
          </button>
          <button
            type="button"
            onClick={() => setShowParsed((v) => !v)}
            className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
            title="查看解析后的结构"
          >
            {showParsed ? "隐藏结构" : "查看结构"}
          </button>
          <button
            type="button"
            onClick={() => copyText(entry.outlineXml)}
            className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
            title="复制 XML 文本"
          >
            复制XML
          </button>
          <button
            type="button"
            onClick={() => downloadText(entry.title ? `${entry.title}.xml` : "outline.xml", entry.outlineXml)}
            className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
            title="下载 XML 文件"
          >
            下载XML
          </button>
        </div>
      </div>

      {showXml && (
        <pre className="mt-3 p-3 border border-black/10 bg-white/60 overflow-x-auto text-[13px] leading-[18px]">
          {entry.outlineXml}
        </pre>
      )}

      {showParsed && (
        <div className="mt-4">
          {parsed.full ? (
            <section className="border border-black/12 p-4 bg-white/70">
              <p className="text-[14px] leading-[20px]">
                标题：<span className="font-medium">{parsed.full.title || "（无）"}</span>
              </p>
              <p className="mt-1 text-[14px] leading-[20px]">
                前提：<span className="text-black/80">{parsed.full.premise}</span>
              </p>
              <div className="mt-3 space-y-3">
                {parsed.full.chapters.map((ch, idx) => (
                  <div key={idx} className="border border-black/10 border-l-[3px] p-4 bg-white/60">
                    <h4 className="text-[18px] leading-[24px] font-semibold">{ch.chapterTitle}</h4>
                    <ol className="mt-3 divide-y divide-black/10">
                      {ch.sections.map((sec, j) => (
                        <li key={j}>
                          <div className="text-[13px] leading-[18px] font-medium">{sec.sectionTitle}</div>
                          <div className="text-[13px] leading-[18px] text-black/70">{sec.summary}</div>
                          {onCreateSection && (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => onCreateSection(entry, idx, j, sec.sectionTitle)}
                                className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                                title="载入并为此节创建故事"
                              >
                                载入并为此节创建故事
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
              {parsed.full.ending && (
                <p className="mt-3 text-[14px] leading-[20px]">
                  结局：<span className="text-black/80">{parsed.full.ending}</span>
                </p>
              )}
            </section>
          ) : parsed.minimal ? (
            <section className="border border-black/12 p-4 bg-white/70">
              <p className="text-[14px] leading-[20px]">
                前提：<span className="text-black/80">{parsed.minimal.premise}</span>
              </p>
              <ol className="mt-3 divide-y divide-black/10">
                {parsed.minimal.beats.map((b, i) => (
                  <li key={i} className="pt-2">
                    <div className="text-[13px] leading-[18px]">{b}</div>
                    {onCreateSection && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => onCreateSection(entry, 0, i, `第${i + 1}节`)}
                          className="h-10 px-4 rounded-[4px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                          title="载入并为此节创建故事"
                        >
                          载入并为此节创建故事
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <p className="text-[13px] leading-[18px] text-red-600">无法解析该 XML。</p>
          )}
        </div>
      )}
    </div>
  );
}

type RoleForm = {
  roleId: string;
  roleName: string;
  selected: boolean;
  expanded: boolean;
  questions: UIQuestion[];
};

function makeDefaultQuestions(): UIQuestion[] {
  return DEFAULT_QUESTIONS.map((q) => ({ ...q, a: "" }));
}

function newRoleName(n: number): string {
  return `角色${n}`;
}

// 本地存储键名
const ROLES_CACHE_KEY = "manosaba_ai.roles";
const SECTION_STORIES_PREFIX = "manosaba_ai.section_stories.";
const SECTION_EXPAND_PREFIX = "manosaba_ai.section_expand.";

// 从本地存储加载角色数据
function loadRolesFromCache(): RoleForm[] {
  if (typeof window === "undefined") return [];
  try {
    const cached = localStorage.getItem(ROLES_CACHE_KEY);
    if (!cached) return [];
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // 验证数据结构完整性
      const valid = parsed.every(role =>
        role.roleId &&
        role.roleName &&
        typeof role.selected === "boolean" &&
        typeof role.expanded === "boolean" &&
        Array.isArray(role.questions)
      );
      if (valid) return parsed;
    }
  } catch (e) {
    console.warn("Failed to load roles from cache:", e);
  }
  return [];
}

// 保存角色数据到本地存储
function saveRolesToCache(roles: RoleForm[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ROLES_CACHE_KEY, JSON.stringify(roles));
  } catch (e) {
    console.warn("Failed to save roles to cache:", e);
  }
}

export default function Home() {
  const [roles, setRoles] = useState<RoleForm[]>([]);
  const [isClient, setIsClient] = useState(false);
  // 开始界面：初始显示左下角按钮行，点击后进入主界面
  const [showStartMenu, setShowStartMenu] = useState(true);
  // 同步“开始界面”状态到 body 类（用于初始页面隐藏 API 插头按钮）
  useEffect(() => {
    try {
      const b = document.body;
      if (showStartMenu) b.classList.add("start-phase");
      else b.classList.remove("start-phase");
    } catch {}
  }, [showStartMenu]);
  // 将“开始界面”状态同步到 body 类，供右上角 ApiConfigPanel 判断是否隐藏按钮
  useEffect(() => {
    try {
      const b = document.body;
      if (showStartMenu) b.classList.add("start-phase");
      else b.classList.remove("start-phase");
    } catch {}
  }, [showStartMenu]);

  // 监听全局“回到初始页面”事件（由右上角房子按钮触发）
  useEffect(() => {
    const goHome = () => {
      try {
        setShowStartMenu(true);
        // 同步状态类（上面的 effect 会处理），此处只需确保快速返回起始 UI
      } catch {}
    };
    window.addEventListener("app:goHome" as any, goHome as any);
    return () => window.removeEventListener("app:goHome" as any, goHome as any);
  }, []);

  // 客户端水合后加载数据
  useEffect(() => {
    setIsClient(true);
    // 首先尝试从缓存加载
    const cached = loadRolesFromCache();
    if (cached.length > 0) {
      setRoles(cached);
    } else {
      // 缓存为空时创建默认角色
      const id = typeof crypto !== "undefined" && "randomUUID" in crypto
        // @ts-ignore
        ? crypto.randomUUID()
        : `role_${Date.now()}`;
      setRoles([
        {
          roleId: id,
          roleName: newRoleName(1),
          selected: true,
          expanded: true,
          questions: makeDefaultQuestions(),
        },
      ]);
    }
  }, []);

  // 监听 roles 变化并自动保存到缓存（仅在客户端）
  useEffect(() => {
    if (isClient && roles.length > 0) {
      saveRolesToCache(roles);
    }
  }, [roles, isClient]);

  const [step, setStep] = useState<"form" | "progress" | "result">("form");
  const [sessionId, setSessionId] = useState<string>(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      // @ts-ignore
      return crypto.randomUUID();
    }
    return `sess_${Date.now()}`;
  });

  const [stage, setStage] = useState<{
    profile: StageStatus;
    outline: StageStatus;
    story: StageStatus;
  }>({
    profile: "idle",
    outline: "idle",
    story: "idle",
  });

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [story, setStory] = useState<{ title: string; content: string } | null>(null);
  const [completing, setCompleting] = useState<Record<string, boolean>>({});
  function isCompleting(id: string): boolean {
    return !!completing[id];
  }

  // 主人公选择状态
  const [protagonist, setProtagonist] = useState<string>("");
  // 从流程或历史载入的主人公名称（用于模板占位符替换，支持从历史直接生成小节）
  const [protagonistNameState, setProtagonistNameState] = useState<string>("");

  // 组装后的“中文提示词”变量（仅内存，不落盘；最终发给 AI 使用中文键名）
  const [rolesPrompt, setRolesPrompt] = useState<PromptPayloadCN | null>(null);
  // 以 XML 字符串形式保存“人物提示词”（不使用 JSON，直接可发给 AI）
  const [rolesPromptXml, setRolesPromptXml] = useState<string | null>(null);
  const [outlineFull, setOutlineFull] = useState<FullOutlineXML | null>(null);
  const [outlineMinimal, setOutlineMinimal] = useState<OutlineXML | null>(null);
  const [outlineTitle, setOutlineTitle] = useState<string | undefined>(undefined);
  const [outlineXmlText, setOutlineXmlText] = useState<string>("");
  const [currentOutlineKey, setCurrentOutlineKey] = useState<string | null>(null);
  const [sectionExpand, setSectionExpand] = useState<Record<string, boolean>>({});


  // CG 背景列表与切换状态（高质感切换 + 会话缓存 + 记忆当前索引）
  const cgList = ["/cg/Still_001_001.png", "/cg/Still_002_001.png", "/cg/Still_110_001.png", "/cg/Still_360_001.png", "/cg/Still_400_001.png"];

  // 会话级缓存：原始路径 -> objectURL（首次加载后复用，避免重复下载）
  const cacheRef = useRef<Map<string, string>>(new Map());
  const [currentCgIdx, setCurrentCgIdx] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem("cg.currentIdx");
        const i = saved ? parseInt(saved, 10) : 0;
        if (!Number.isNaN(i) && i >= 0 && i < cgList.length) return i;
      } catch {}
    }
    return 0;
  });
  const [lastCgIdx, setLastCgIdx] = useState<number | null>(null);
  const [resolvedCurrent, setResolvedCurrent] = useState<string | null>(null);
  const [resolvedLast, setResolvedLast] = useState<string | null>(null);
  // 加载指示：首次进入与切换背景时显示美观加载动画
  const [bgLoading, setBgLoading] = useState<boolean>(true);
  // 避免 SSR 首屏使用索引 0 导致刷新后先显示首图再切到上次图：仅在水合后再渲染背景层；同时控制左右箭头/指示器显隐
  const [hydrated, setHydrated] = useState(false);
  const [arrowVisible, setArrowVisible] = useState(false);
  // 分侧激活：用于只显示对应侧阴影
  const [leftZoneActive, setLeftZoneActive] = useState(false);
  const [rightZoneActive, setRightZoneActive] = useState(false);
  const [bgOk, setBgOk] = useState<boolean>(false);
  const blackRemovedRef = useRef<boolean>(false);
  // 首次 UI 显示控制（等待背景动画结束）
  const initialUiShownRef = useRef<boolean>(false);
  useEffect(() => {
    setHydrated(true);
    // 触控设备无 hover，保持箭头与指示器常显（两侧均激活）
    try {
      const mm = window.matchMedia?.("(hover: none)");
      if (mm && mm.matches) {
        setLeftZoneActive(true);
        setRightZoneActive(true);
      }
    } catch {}
    // 初始阶段：进入纯黑屏，并隐藏前景 UI（直到背景成功获取）
    try {
      const b = document.body;
      b.classList.add("initial-black");
      b.classList.add("initial-hidden");
    } catch {}
  }, []);

  // 背景成功加载后：固定显示 0.5s 黑屏，再移除；若背景未成功获取则保持黑屏
  useEffect(() => {
    try {
      const b = document.body;
      if (!hydrated) return;
      // 仅当背景加载完成（bgLoading=false）且成功加载（bgOk=true），并且尚未移除黑屏时触发
      if (!bgLoading && bgOk && !blackRemovedRef.current) {
        const t = setTimeout(() => {
          try {
            b.classList.remove("initial-black");
            blackRemovedRef.current = true;
          } catch {}
        }, 500);
        return () => clearTimeout(t);
      }
    } catch {}
  }, [bgLoading, bgOk, hydrated]);

  // 仅在首次入场时，等待“背景动画”完成后再显现 UI（之后切换背景不再隐藏 UI）
  useEffect(() => {
    const b = document.body;
    if (!hydrated) return;

    // 仅首屏：背景尚未加载完，确保 UI 隐藏
    if (!initialUiShownRef.current && bgLoading) {
      try {
        b.classList.add("initial-hidden");
        b.classList.remove("initial-ready");
      } catch {}
      return;
    }

    // 仅首屏：背景已加载但 UI 未显现 → 监听背景动画结束
    if (!initialUiShownRef.current && !bgLoading) {
      let timeoutId: any = null;
      const layer = document.querySelector(".cg-layer.cg-fade-in") as HTMLElement | null;

      const onEnd = () => {
        if (initialUiShownRef.current) return;
        initialUiShownRef.current = true;
        try {
          b.classList.remove("initial-hidden");
          b.classList.add("initial-ready");
        } catch {}
        if (layer) layer.removeEventListener("animationend", onEnd);
        if (timeoutId) clearTimeout(timeoutId);
      };

      if (layer) {
        layer.addEventListener("animationend", onEnd);
        // 后备保护：若动画事件未触发，按背景动画时长稍作冗余后强制显现（4000ms + 300ms）
        timeoutId = setTimeout(onEnd, 4300);
      } else {
        // 未找到当前层：直接使用超时后显现
        timeoutId = setTimeout(onEnd, 4300);
      }

      return () => {
        if (layer) layer.removeEventListener("animationend", onEnd);
        if (timeoutId) clearTimeout(timeoutId);
      };
    }
  }, [bgLoading, hydrated]);

  // 指示器显隐由分侧激活驱动（hover: none 时已在首个 effect 中置为 true）
  useEffect(() => {
    setArrowVisible(leftZoneActive || rightZoneActive);
  }, [leftZoneActive, rightZoneActive]);

  async function ensureCached(path: string): Promise<string> {
    const cached = cacheRef.current.get(path);
    if (cached) return cached;
    const res = await fetch(path, { cache: "force-cache" });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    cacheRef.current.set(path, url);
    return url;
  }

  // 解析并等待图片加载完成，保证切换时不出现空白（返回是否成功加载）
  async function resolveAndLoad(path: string): Promise<{ url: string; ok: boolean }> {
    try {
      const url = await ensureCached(path);
      const ok = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
      });
      return { url, ok };
    } catch {
      // 网络或缓存失败时，标记为未成功加载
      return { url: path, ok: false };
    }
  }

  // 当索引变化时：更新本地存储并解析当前图的缓存 URL（等待图片加载）
  useEffect(() => {
    let mounted = true;
    try {
      localStorage.setItem("cg.currentIdx", String(currentCgIdx));
    } catch {}
    setBgLoading(true);
    resolveAndLoad(cgList[currentCgIdx]).then(({ url, ok }) => {
      if (mounted) {
        setResolvedCurrent(url);
        setBgOk(ok);
        setBgLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [currentCgIdx]);

  // 清理：组件卸载时撤销所有 objectURL，避免内存泄露
  useEffect(() => {
    return () => {
      for (const url of cacheRef.current.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
      cacheRef.current.clear();
    };
  }, []);

  function goNext() {
    const nextIdx = (currentCgIdx + 1) % cgList.length;
    setLastCgIdx(currentCgIdx);
    // 上一层使用缓存的已加载 URL（若无则补充缓存，不阻塞）
    const lastPath = cgList[currentCgIdx];
    const lastCached = cacheRef.current.get(lastPath);
    if (lastCached) setResolvedLast(lastCached);
    else ensureCached(lastPath).then((url) => setResolvedLast(url));

    setBgLoading(true);
    setCurrentCgIdx(nextIdx);
    resolveAndLoad(cgList[nextIdx]).then(({ url, ok }) => {
      setResolvedCurrent(url);
      setBgOk(ok);
      setBgLoading(false);
    });
    // 动效结束后清理上一层
    setTimeout(() => setLastCgIdx(null), 800);
  }
  function goPrev() {
    const prevIdx = (currentCgIdx - 1 + cgList.length) % cgList.length;
    setLastCgIdx(currentCgIdx);
    // 上一层使用缓存的已加载 URL（若无则补充缓存，不阻塞）
    const lastPath = cgList[currentCgIdx];
    const lastCached = cacheRef.current.get(lastPath);
    if (lastCached) setResolvedLast(lastCached);
    else ensureCached(lastPath).then((url) => setResolvedLast(url));

    setBgLoading(true);
    setCurrentCgIdx(prevIdx);
    resolveAndLoad(cgList[prevIdx]).then(({ url, ok }) => {
      setResolvedCurrent(url);
      setBgOk(ok);
      setBgLoading(false);
    });
    setTimeout(() => setLastCgIdx(null), 800);
  }

  // 键盘快捷键（左右方向键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentCgIdx]);

  // 工具方法：统计每个角色的回答数
  function answeredCount(role: RoleForm): number {
    return role.questions.filter((q) => q.a.trim().length > 0).length;
  }

  const selectedRoles = useMemo(() => roles.filter((r) => r.selected), [roles]);
  const invalidSelectedRoles = useMemo(
    () => selectedRoles.filter((r) => answeredCount(r) < 7),
    [selectedRoles, roles]
  );

  const canSubmit = useMemo(
    () => !running && selectedRoles.length === 12 && invalidSelectedRoles.length === 0 && protagonist,
    [running, selectedRoles, invalidSelectedRoles, protagonist]
  );

  function resetAll() {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? // @ts-ignore
          crypto.randomUUID()
        : `role_${Date.now()}`;
    const newRoles = [
      {
        roleId: id,
        roleName: newRoleName(1),
        selected: true,
        expanded: true,
        questions: makeDefaultQuestions(),
      },
    ];
    setRoles(newRoles);
    // 清除缓存
    try {
      localStorage.removeItem(ROLES_CACHE_KEY);
    } catch (e) {
      console.warn("Failed to clear roles cache:", e);
    }
    setSessionId(
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? // @ts-ignore
          crypto.randomUUID()
        : `sess_${Date.now()}`
    );
    setStage({ profile: "idle", outline: "idle", story: "idle" });
    setError(null);
    setStory(null);
    setStep("form");
  }

  function clearCache() {
    try {
      localStorage.removeItem(ROLES_CACHE_KEY);
      // 重新加载页面以应用清除缓存的效果
      window.location.reload();
    } catch (e) {
      console.warn("Failed to clear cache:", e);
    }
  }

  function addRole() {
    setRoles((prev) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? // @ts-ignore
            crypto.randomUUID()
          : `role_${Date.now()}`;
      const nextIdx = prev.length + 1;
      return [
        ...prev,
        {
          roleId: id,
          roleName: newRoleName(nextIdx),
          selected: true,
          expanded: true,
          questions: makeDefaultQuestions(),
        },
      ];
    });
  }

  function removeRole(roleId: string) {
    setRoles((prev) => {
      if (prev.length <= 1) return prev; // 保底：至少保留一个角色
      return prev.filter((r) => r.roleId !== roleId);
    });
  }

  function renameRole(roleId: string, nextName: string) {
    setRoles((prev) => prev.map((r) => (r.roleId === roleId ? { ...r, roleName: nextName } : r)));
  }

  function toggleRoleSelected(roleId: string) {
    setRoles((prev) => prev.map((r) => (r.roleId === roleId ? { ...r, selected: !r.selected } : r)));
  }

  function toggleRoleExpanded(roleId: string) {
    setRoles((prev) => prev.map((r) => (r.roleId === roleId ? { ...r, expanded: !r.expanded } : r)));
  }


  function clearAnswers(roleId: string) {
    setRoles((prev) =>
      prev.map((r) =>
        r.roleId === roleId
          ? { ...r, questions: r.questions.map((q) => ({ ...q, a: "" })) }
          : r
      )
    );
  }


  function updateA(roleId: string, id: string, nextA: string) {
    setRoles((prev) =>
      prev.map((r) =>
        r.roleId === roleId
          ? { ...r, questions: r.questions.map((x) => (x.id === id ? { ...x, a: nextA } : x)) }
          : r
      )
    );
  }

  async function completeRole(roleId: string) {
    setCompleting((prev) => ({ ...prev, [roleId]: true }));
    try {
      const role = roles.find((r) => r.roleId === roleId);
      if (!role) return;

      const qa = role.questions
        .filter((x) => x.a.trim().length > 0)
        .map((x) => ({ q: x.q.trim(), a: x.a.trim() }));

      const r = await fetch("/api/session/complete-role", {
        method: "POST",
        headers: (() => {
          try {
            const raw = localStorage.getItem("manosaba_ai.api_config");
            const cfg = raw ? JSON.parse(raw) : {};
            const h: Record<string, string> = { "Content-Type": "application/json" };
            if (cfg.AI_API_KEY) h["x-ai-api-key"] = cfg.AI_API_KEY;
            if (cfg.AI_BASE_URL) h["x-ai-base-url"] = cfg.AI_BASE_URL;
            if (cfg.AI_MODEL_ID) h["x-ai-model-id"] = cfg.AI_MODEL_ID;
            return h;
          } catch {
            return { "Content-Type": "application/json" };
          }
        })(),
        body: JSON.stringify({
          sessionId,
          roleId: role.roleId,
          roleName: role.roleName.trim() || "未命名角色",
          qa,
        }),
      });
      if (!r.ok) throw new Error(`AI 补全接口错误：${r.status}`);
      const j = await r.json();
      if (!j.ok || j.parseOk === false) throw new Error("AI 补全解析失败");

      const { name, age, appearanceClothes, magicPre, magicPost, tragicStory, personality, originalSin } = j.extracted ?? {};

      setRoles((prev) =>
        prev.map((rr) =>
          rr.roleId !== roleId
            ? rr
            : {
                ...rr,
                roleName: (name?.trim() || rr.roleName),
                questions: rr.questions.map((x) => {
                  switch (x.id) {
                    case "q1":
                      return { ...x, a: name ?? x.a };
                    case "q2":
                      return { ...x, a: age ?? x.a };
                    case "q3":
                      return { ...x, a: appearanceClothes ?? x.a };
                    case "q4":
                      return {
                        ...x,
                        a: [magicPre, magicPost].filter(Boolean).join("\n") || x.a,
                      };
                    case "q5":
                      return { ...x, a: tragicStory ?? x.a };
                    case "q6":
                      return { ...x, a: personality ?? x.a };
                    case "q7":
                      return { ...x, a: originalSin ?? x.a };
                    default:
                      return x;
                  }
                }),
              }
        )
      );
    } catch (e: any) {
      setError(e?.message ?? "AI 补全失败");
    } finally {
      setCompleting((prev) => ({ ...prev, [roleId]: false }));
    }
  }

  async function runWorkflow() {
    setError(null);
    setRunning(true);
    setStep("progress");
    setStage({ profile: "running", outline: "idle", story: "idle" });

    // 构造"已勾选角色"的问答
    const selected = roles.filter((r) => r.selected);
    if (selected.length !== 12) {
      setError("必须严格勾选 12 个角色才能生成故事。");
      setStage((s) => ({ ...s, profile: "error" }));
      setRunning(false);
      return;
    }
    if (selected.some((r) => answeredCount(r) < 7)) {
      setError("每个勾选的角色必须回答完全部 7 个问题。");
      setStage((s) => ({ ...s, profile: "error" }));
      setRunning(false);
      return;
    }
    if (!protagonist) {
      setError("请选择一个主人公角色。");
      setStage((s) => ({ ...s, profile: "error" }));
      setRunning(false);
      return;
    }

    try {
      // 1) 在前端内存中组装“中文键名”的人物列表（固定追加第13位：冰上 梅露露）
      const protagonistRole = selected.find((r) => r.roleId === protagonist)!;
      const protagonistName = (protagonistRole?.roleName?.trim() || "未命名角色");
      setProtagonistNameState(protagonistName);

      const charactersEN = selected.map(mapRoleToPromptCharacter);
      const meruruEN = getMeruruCharacter();

      const charactersCN: PromptCharacterCN[] = [
        ...charactersEN.map((c) => ({
          姓名: c.name,
          外貌与衣着: c.appearance,
          魔女化前的能力: c.magic_pre,
          魔女化后的能力: c.magic_post,
          悲惨故事: c.tragic_story,
          性格特质: c.personality,
          原罪: c.original_sin,
        })),
        {
          姓名: meruruEN.name,
          外貌与衣着: meruruEN.appearance,
          魔女化前的能力: meruruEN.magic_pre,
          魔女化后的能力: meruruEN.magic_post,
          悲惨故事: meruruEN.tragic_story,
          性格特质: meruruEN.personality,
          原罪: meruruEN.original_sin,
        },
      ];

      const promptPayloadCN: PromptPayloadCN = {
        主人公名称: protagonistName,
        人物列表: charactersCN,
      };
      setRolesPrompt(promptPayloadCN);
      (window as any).rolesPrompt = promptPayloadCN;
      console.info("rolesPrompt(CN Object)", promptPayloadCN);

      // 2) 将人物提示词转为 XML 字符串（不使用 JSON）
      const charactersXml = buildCharactersXml(protagonistName, charactersCN);
      setRolesPromptXml(charactersXml);
      (window as any).rolesPromptXml = charactersXml;
      console.info("rolesPromptXml", charactersXml);

      // 3) 读取 world_books 大提示词（XML）与生成大纲模板原文，并替换 {{mainCharacter}}
      const rWorld = await fetch("/api/session/world-books", { method: "GET" });
      if (!rWorld.ok) throw new Error(`world-books 接口错误：${rWorld.status}`);
      const worldXml = await rWorld.text();

      const rTpl = await fetch("/api/session/workflow/outline-prompt", { method: "GET" });
      if (!rTpl.ok) throw new Error(`outline-prompt 接口错误：${rTpl.status}`);
      let outlineTpl = await rTpl.text();
      outlineTpl = outlineTpl.replace(/\{\{\s*mainCharacter\s*\}\}/g, protagonistName);

      // 4) 组装最终 rawPrompt：先 world_books XML，再人物 XML，最后模板文本
      const rawPrompt = [worldXml, charactersXml, outlineTpl].join("\n\n");

      setStage((s) => ({ ...s, profile: "done", outline: "running" }));

      // 5) 仅调用“生成大纲”，并将 rawPrompt 直接发送给 AI
      const rOutline = await fetch("/api/session/generate-outline", {
        method: "POST",
        headers: (() => {
          try {
            const raw = localStorage.getItem("manosaba_ai.api_config");
            const cfg = raw ? JSON.parse(raw) : {};
            const h: Record<string, string> = { "Content-Type": "application/json" };
            if (cfg.AI_API_KEY) h["x-ai-api-key"] = cfg.AI_API_KEY;
            if (cfg.AI_BASE_URL) h["x-ai-base-url"] = cfg.AI_BASE_URL;
            if (cfg.AI_MODEL_ID) h["x-ai-model-id"] = cfg.AI_MODEL_ID;
            return h;
          } catch {
            return { "Content-Type": "application/json" };
          }
        })(),
        body: JSON.stringify({ sessionId, rawPrompt }),
      });
      if (!rOutline.ok) throw new Error(`大纲接口错误：${rOutline.status}`);
      const jOutline: OutlineResp = await rOutline.json();
      const outlineXml = jOutline.text ?? "";

      if (!jOutline.ok || jOutline.parseOk === false || !outlineXml) {
        throw new Error("故事大纲解析失败，请稍后重试。");
      }

      // 解析完整/简易结构
      const full = parseFullStoryOutlineXml(outlineXml);
      const minimal = full ? null : parseStoryOutlineXml(outlineXml);
      setOutlineFull(full ?? null);
      setOutlineMinimal(minimal ?? null);
      setOutlineTitle(full?.title);
      setOutlineXmlText(outlineXml);

      // 6) 保存完整大纲 XML（只保存到内存后端）
      void fetch("/api/session/save-outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, outlineXml }),
      }).catch(() => {});

      // 保存至浏览器历史（localStorage）
      const entry: OutlineHistoryEntry = {
        id: `outline_${Date.now()}`,
        sessionId,
        protagonistName,
        createdAt: Date.now(),
        outlineXml,
        charactersXml, // 保存人物提示词 XML 到历史，便于从历史直接生成小节故事
        title: full?.title,
        full: full ?? null,
        minimal: minimal ?? null,
      };
      try { saveOutlineToHistory(entry); } catch {}
      setCurrentOutlineKey(entry.id);

      setStage((s) => ({ ...s, outline: "done", story: "idle" }));

      // 仅生成并展示“故事大纲”，不再将大纲写入 story；后续按小节逐步创作故事
      setOutlineXmlText(outlineXml);

      setStep("result");
    } catch (e: any) {
      setError(e?.message ?? "发生未知错误");
      setStage((s) => {
        if (s.profile === "running") return { ...s, profile: "error" };
        if (s.outline === "running") return { ...s, outline: "error" };
        if (s.story === "running") return { ...s, story: "error" };
        return { ...s, story: "error" };
      });
    } finally {
      setRunning(false);
    }
  }

  function copyStory() {
    if (!story) return;
    const text = `${story.title}\n\n${story.content}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  function downloadStory() {
    if (!story) return;
    const text = `${story.title}\n\n${story.content}`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${story.title || "story"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 每节故事生成缓存：键 = "chapterIdx-sectionIdx"
  const [sectionStories, setSectionStories] = useState<Record<string, string>>({});
  // 当前正在生成的节（用于禁用按钮与显示“创建中...”文案）
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);

  // 章节顺序键列表（用于控制“只允许依次生成”与“只允许最近一节重新生成”）
  const orderedKeys = useMemo(() => {
    if (outlineFull) {
      return outlineFull.chapters.flatMap((ch, ci) => ch.sections.map((_, si) => `${ci}-${si}`));
    } else if (outlineMinimal) {
      return outlineMinimal.beats.map((_, i) => `0-${i}`);
    }
    return [];
  }, [outlineFull, outlineMinimal]);

  function isGeneratedKey(key: string): boolean {
    return !!sectionStories[key];
  }

  const furthestIndex = useMemo(() => {
    let last = -1;
    for (let i = 0; i < orderedKeys.length; i++) {
      if (isGeneratedKey(orderedKeys[i])) last = i;
    }
    return last;
  }, [orderedKeys, sectionStories]);

  function allowCreate(key: string, index: number): boolean {
    if (index < 0) return false;
    if (index === 0) return !isGeneratedKey(key);
    return isGeneratedKey(orderedKeys[index - 1]) && !isGeneratedKey(key);
  }

  function allowRecreate(key: string, index: number): boolean {
    if (index < 0) return false;
    return isGeneratedKey(key) && furthestIndex === index;
  }

  // 大纲历史（首页内联显示，不再跳转到新页面）
  const [showOutlineHistory, setShowOutlineHistory] = useState<boolean>(false);
  const [historyTick, setHistoryTick] = useState<number>(0);
  const historyList: OutlineHistoryEntry[] = useMemo(() => {
    try { return loadOutlineHistory?.() ?? []; } catch { return []; }
  }, [historyTick, showOutlineHistory]);
  function refreshOutlineHistory() { setHistoryTick((x) => x + 1); }
  function clearOutlineHistoryAndRefresh() { try { clearOutlineHistory?.(); } catch {} setHistoryTick((x) => x + 1); }

  // 加载/保存本节生成内容与折叠状态（按当前大纲键分区）
  useEffect(() => {
    if (!currentOutlineKey) return;
    try {
      const s = localStorage.getItem(SECTION_STORIES_PREFIX + currentOutlineKey);
      if (s) setSectionStories(JSON.parse(s));
    } catch {}
    try {
      const e = localStorage.getItem(SECTION_EXPAND_PREFIX + currentOutlineKey);
      if (e) setSectionExpand(JSON.parse(e));
    } catch {}
  }, [currentOutlineKey]);

  useEffect(() => {
    if (!currentOutlineKey) return;
    try {
      localStorage.setItem(SECTION_STORIES_PREFIX + currentOutlineKey, JSON.stringify(sectionStories));
    } catch {}
  }, [sectionStories, currentOutlineKey]);

  useEffect(() => {
    if (!currentOutlineKey) return;
    try {
      localStorage.setItem(SECTION_EXPAND_PREFIX + currentOutlineKey, JSON.stringify(sectionExpand));
    } catch {}
  }, [sectionExpand, currentOutlineKey]);

  // 为某节创建故事前的持久化与错误弹窗工具
  function showErrorPopup(msg: string) {
    try {
      setError(msg);
      setTimeout(() => {
        try { alert(`错误：${msg}`); } catch {}
      }, 300);
    } catch {}
  }
  function getStoriesKeyFor(outlineKey: string) { return SECTION_STORIES_PREFIX + outlineKey; }
  function getExpandKeyFor(outlineKey: string) { return SECTION_EXPAND_PREFIX + outlineKey; }

  // 为某节创建故事
  async function generateSectionStory(chIdx: number, secIdx: number, sectionTitle: string) {
    try {
      setError(null);
      const currentKey = `${chIdx}-${secIdx}`;
      setGeneratingKey(currentKey);

      // 基础校验
      const outlineXml = outlineXmlText ?? "";
      if (!outlineXml) {
        showErrorPopup("尚未加载到大纲 XML，请先生成或查看最近大纲。");
        return;
      }

      // 准备人物 XML（优先使用已构建的 rolesPromptXml，其次从 rolesPrompt 临时构建；若均缺失则以空列表降级以允许从历史直接生成）
      let charactersXml = rolesPromptXml ?? "";
      if (!charactersXml) {
        const protagonistName =
          rolesPrompt?.主人公名称 ||
          roles.find(r => r.roleId === protagonist)?.roleName?.trim() ||
          protagonistNameState ||
          "未命名角色";
        const list = rolesPrompt?.人物列表;
        try {
          charactersXml = buildCharactersXml(protagonistName, Array.isArray(list) ? list : []);
        } catch {
          // 降级：构建空人物列表的 XML
          charactersXml = buildCharactersXml(protagonistName, []);
        }
      }

      // 世界书大提示词（XML）
      const rWorld = await fetch("/api/session/world-books", { method: "GET" });
      if (!rWorld.ok) {
        showErrorPopup(`world-books 接口错误：${rWorld.status}`);
        return;
      }
      const worldXml = await rWorld.text();

      // 读取“生成故事”模板，并替换占位符
      const rTpl = await fetch("/api/session/workflow/story-prompt", { method: "GET" });
      if (!rTpl.ok) {
        showErrorPopup(`story-prompt 接口错误：${rTpl.status}`);
        return;
      }
      let storyTpl = await rTpl.text();

      const protagonistNameForTpl =
        rolesPrompt?.主人公名称 ||
        roles.find(r => r.roleId === protagonist)?.roleName?.trim() ||
        protagonistNameState ||
        "未命名角色";

      storyTpl = storyTpl
        .replace(/\{\{\s*mainCharacter\s*\}\}/g, protagonistNameForTpl)
        .replace(/\{\{\s*sectionTitle\s*\}\}/g, sectionTitle);

      // 上一节内容（若为首节则为空）
      const prevKey = `${chIdx}-${secIdx - 1}`;
      const prevText = secIdx > 0 ? (sectionStories[prevKey] ?? "") : "";

      // 组装 rawPrompt：世界书 XML + 人物 XML + 大纲完整 XML + 上一节内容 + 模板
      const parts = [
        worldXml,
        charactersXml,
        outlineXml,
        prevText ? `上一节内容：\n${prevText}` : "",
        storyTpl,
      ].filter(Boolean);
      const rawPrompt = parts.join("\n\n");

      // 调用“为小节生成故事”的 API
      const r = await fetch("/api/session/generate-section-story", {
        method: "POST",
        headers: (() => {
          try {
            const raw = localStorage.getItem("manosaba_ai.api_config");
            const cfg = raw ? JSON.parse(raw) : {};
            const h: Record<string, string> = { "Content-Type": "application/json" };
            if (cfg.AI_API_KEY) h["x-ai-api-key"] = cfg.AI_API_KEY;
            if (cfg.AI_BASE_URL) h["x-ai-base-url"] = cfg.AI_BASE_URL;
            if (cfg.AI_MODEL_ID) h["x-ai-model-id"] = cfg.AI_MODEL_ID;
            return h;
          } catch {
            return { "Content-Type": "application/json" };
          }
        })(),
        body: JSON.stringify({ sessionId, rawPrompt }),
      });
      if (!r.ok) {
        showErrorPopup(`生成小节故事接口错误：${r.status}`);
        return;
      }
      const j = await r.json();
      if (!j.ok) {
        showErrorPopup(j?.message ?? "生成小节故事失败");
        return;
      }

      const text: string = j.finalStory?.content || j.text || "";
      if (!text) {
        showErrorPopup("生成的小节故事为空");
        return;
      }

      const key = `${chIdx}-${secIdx}`;
      setSectionStories(prev => ({ ...prev, [key]: text }));
      setSectionExpand(prev => ({ ...prev, [key]: true })); // 默认生成后展开
      setGeneratingKey(null);
    } catch (e: any) {
      setError(e?.message ?? "生成小节故事失败");
    } finally {
      setGeneratingKey(null);
    }
  }
  // 查看最新历史大纲：直接切换到“结果”视图并展示上次保存的大纲
  function showLatestOutlineFromHistory() {
    try {
      const list = loadOutlineHistory?.() ?? [];
      if (!Array.isArray(list) || list.length === 0) {
        setError("暂无历史大纲，请先生成一次大纲。");
        return;
      }
      const entry = list[0];
      const outlineXml = entry.outlineXml ?? "";
      if (!outlineXml) {
        setError("历史记录为空或无效。");
        return;
      }

      const full = parseFullStoryOutlineXml(outlineXml);
      const minimal = full ? null : parseStoryOutlineXml(outlineXml);

      setOutlineFull(full ?? null);
      setOutlineMinimal(minimal ?? null);
      setOutlineTitle(full?.title);
      setOutlineXmlText(outlineXml);
      // 从历史载入人物提示词 XML（若存在）与主人公名称
      if (entry.charactersXml) {
        setRolesPromptXml(entry.charactersXml);
      }
      setProtagonistNameState(entry.protagonistName || "");
      setCurrentOutlineKey(entry.id);

      // 更新阶段状态并跳转到结果页（仅展示大纲）
      setStage({ profile: "done", outline: "done", story: "idle" });
      setStep("result");
    } catch (e: any) {
      setError(e?.message ?? "读取历史失败");
    }
  }
  // 载入指定历史大纲至当前工作区，支持从历史直接逐节创作
  function loadHistoryEntry(entry: OutlineHistoryEntry) {
    try {
      const outlineXml = entry.outlineXml ?? "";
      if (!outlineXml) {
        setError("历史记录为空或无效。");
        return;
      }
      const full = entry.full ?? parseFullStoryOutlineXml(outlineXml);
      const minimal = full ? null : (entry.minimal ?? parseStoryOutlineXml(outlineXml));
      setOutlineFull(full ?? null);
      setOutlineMinimal(minimal ?? null);
      setOutlineTitle(entry.title ?? full?.title);
      setOutlineXmlText(outlineXml);
      if (entry.charactersXml) {
        setRolesPromptXml(entry.charactersXml);
      }
      setProtagonistNameState(entry.protagonistName || "");
      setCurrentOutlineKey(entry.id);
      setStage({ profile: "done", outline: "done", story: "idle" });
      setStep("result");
      setShowOutlineHistory(false);
    } catch (e: any) {
      setError(e?.message ?? "载入历史失败");
    }
  }
  // 从历史卡片内“一键载入并生成指定小节”
  function loadAndCreateSection(entry: OutlineHistoryEntry, chIdx: number, secIdx: number, sectionTitle: string) {
    try {
      loadHistoryEntry(entry);
      // 等待状态写入后再触发生成，避免状态未就绪
      setTimeout(() => generateSectionStory(chIdx, secIdx, sectionTitle), 0);
    } catch {}
  }
  const currentStepNo = step === "form" ? 1 : step === "progress" ? 2 : 3;

  return (
    <div className="min-h-screen text-black">
      {/* CG 背景层：双层叠加实现平滑交叉淡入淡出（仅在水合完成后渲染，避免刷新先出现首图） */}
      <div className="fixed inset-0 z-[1] pointer-events-none">
        {hydrated && (
          <>
            {/* 加载动画覆盖层（美观玻璃态），在背景解析与图片加载期间显示 */}
            {bgLoading && (
              <div className="cg-loading-overlay">
                <div className="loader-wrap">
                  <div className="loader-ring" />
                  <div className="loader-caption">加载背景…</div>
                </div>
              </div>
            )}
            {lastCgIdx !== null && (
              <div
                className="cg-layer cg-fade-out"
                style={{ backgroundImage: `url(${resolvedLast ?? cgList[lastCgIdx]})` }}
              />
            )}
            <div
              key={currentCgIdx}
              className="cg-layer cg-fade-in"
              style={{ backgroundImage: `url(${resolvedCurrent ?? cgList[currentCgIdx]})` }}
            />
            {/* 左右边缘浅黑渐隐（与分侧激活同步，仅显示对应侧阴影） */}
            {(leftZoneActive || rightZoneActive) && (
              <>
                {leftZoneActive && (
                  <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-black/30 to-transparent ui-visible" />
                )}
                {rightZoneActive && (
                  <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-black/30 to-transparent ui-visible" />
                )}
              </>
            )}

            {/* 全局四角三角形浅黑半透明渐变（保持在 UI 隐藏时依然可见：不使用 ui-visible） */}
            <div className="corner-fades">
              <div className="corner-tri tl" />
              <div className="corner-tri tr" />
              <div className="corner-tri bl" />
              <div className="corner-tri br" />
            </div>
          </>
        )}
      </div>

      {/* 底部居中指示器（仅在水合完成且箭头可见时渲染，与边缘悬停显隐同步） */}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[20] ui-visible">
        {hydrated && (leftZoneActive || rightZoneActive) && (
          <div className="cg-indicator" aria-live="polite" aria-atomic="true" title="当前背景页码">
            {currentCgIdx + 1} / {cgList.length}
          </div>
        )}
      </div>

      {/* 左右侧背景切换按钮（边缘悬停渐显，离开渐隐；右箭头为原图，左箭头镜像） */}
      <div
        className="nav-zone nav-zone-left fixed inset-y-0 left-0 z-[20] flex items-center px-4 ui-visible"
        onMouseEnter={() => setLeftZoneActive(true)}
        onMouseLeave={() => setLeftZoneActive(false)}
      >
        <button
          type="button"
          aria-label="上一张背景"
          onClick={goPrev}
          className="nav-arrow-btn no-select"
        >
          <img
            src="/tools/arrow.png"
            alt="上一张背景"
            className="nav-arrow-img nav-arrow-left no-select"
            decoding="async"
            draggable="false"
          />
        </button>
      </div>
      <div
        className="nav-zone nav-zone-right fixed inset-y-0 right-0 z-[20] flex items-center px-4 ui-visible"
        onMouseEnter={() => setRightZoneActive(true)}
        onMouseLeave={() => setRightZoneActive(false)}
      >
        <button
          type="button"
          aria-label="下一张背景"
          onClick={goNext}
          className="nav-arrow-btn no-select"
        >
          <img
            src="/tools/arrow.png"
            alt="下一张背景"
            className="nav-arrow-img nav-arrow-right no-select"
            decoding="async"
            draggable="false"
          />
        </button>
      </div>

      {/* 开始界面：左下角按钮行（初始显示），点击 NewGame/LoadGame 进入主界面 */}
      {showStartMenu && (
        <>
          {/* 标题图：开始页面右上角（适当放大），不影响交互 */}
          <div className="title-top-right fixed top-6 right-6 z-[26] ui-visible pointer-events-none">
            <img
              src="/start_ui/start_title.png"
              alt="魔女裁决 标题图"
              className="block w-[680px] h-auto object-contain no-select"
              decoding="async"
              draggable="false"
            />
          </div>

          {/* 左下角按钮行 */}
          <div className="start-menu fixed bottom-6 left-6 z-[25] ui-visible flex items-end gap-0">
            {/* LoadGame */}
            <button
              type="button"
              className="group relative start-btn no-select"
              aria-label="LoadGame"
              onClick={() => {
                try {
                  const list = loadOutlineHistory?.() ?? [];
                  if (!Array.isArray(list) || list.length === 0) {
                    alert('暂无历史大纲，请先生成一次大纲。');
                    return;
                  }
                  setShowStartMenu(false);
                  showLatestOutlineFromHistory();
                } catch {
                  // 容错：仍尝试进入历史视图
                  setShowStartMenu(false);
                  showLatestOutlineFromHistory();
                }
              }}
            >
              <img
                src="/start_ui/LoadGame-unselected.png"
                alt="LoadGame"
                className="start-btn-img unselected block w-[303px] h-[189px] object-contain transition-opacity duration-150 opacity-100 group-hover:opacity-0"
                decoding="async"
                draggable="false"
              />
              <img
                src="/start_ui/LoadGame-selected.png"
                alt="LoadGame"
                className="start-btn-img selected absolute top-0 left-0 w-[303px] h-[189px] object-contain transition-opacity duration-150 opacity-0 group-hover:opacity-100"
                decoding="async"
                draggable="false"
              />
            </button>

            {/* NewGame（上移，且与 Gallery 高度一致） */}
            <button
              type="button"
              className="group relative start-btn raised no-select -translate-y-9 ml-[-100px]"
              aria-label="NewGame"
              onClick={() => { setShowStartMenu(false); setStep('form'); }}
            >
              <img
                src="/start_ui/NewGame-unselected.png"
                alt="NewGame"
                className="start-btn-img unselected block w-[303px] h-[189px] object-contain transition-opacity duration-150 opacity-100 group-hover:opacity-0"
                decoding="async"
                draggable="false"
              />
              <img
                src="/start_ui/NewGame-selected.png"
                alt="NewGame"
                className="start-btn-img selected absolute top-0 left-0 w-[303px] h-[189px] object-contain transition-opacity duration-150 opacity-0 group-hover:opacity-100"
                decoding="async"
                draggable="false"
              />
            </button>

            {/* Gallery（上移，且与 NewGame 高度一致） */}
            <button
              type="button"
              className="group relative start-btn no-select ml-[-90px]"
              aria-label="Gallery"
              onClick={() => { /* TODO: Gallery */ }}
            >
              <img
                src="/start_ui/Gallery-unselected.png"
                alt="Gallery"
                className="start-btn-img unselected block w-[194px] h-auto transition-opacity duration-150 opacity-100 group-hover:opacity-0"
                decoding="async"
                draggable="false"
              />
              <img
                src="/start_ui/Gallery-selected.png"
                alt="Gallery"
                className="start-btn-img selected absolute top-0 left-0 w-[194px] h-auto transition-opacity duration-150 opacity-0 group-hover:opacity-100"
                decoding="async"
                draggable="false"
              />
            </button>

            {/* Options */}
            <button
              type="button"
              className="group relative start-btn no-select -translate-y-9 ml-[-45px]"
              aria-label="Options"
              onClick={() => { /* TODO: Options 面板 */ }}
            >
              <img
                src="/start_ui/Options-unselected.png"
                alt="Options"
                className="start-btn-img unselected block w-[194px] h-auto transition-opacity duration-150 opacity-100 group-hover:opacity-0"
                decoding="async"
                draggable="false"
              />
              <img
                src="/start_ui/Options-selected.png"
                alt="Options"
                className="start-btn-img selected absolute top-0 left-0 transition-opacity duration-150 opacity-0 group-hover:opacity-100 w-[194px] h-auto"
                decoding="async"
                draggable="false"
              />
            </button>

            {/* Exit */}
            <button
              type="button"
              className="group relative start-btn no-select ml-[-50px]"
              aria-label="Exit"
              onClick={() => {
                try {
                  // 尝试多种方式关闭当前网页（不同浏览器策略不同）
                  // 方案1：直接关闭（需同源且由脚本打开的窗口）
                  window.open('', '_self');
                  window.close();

                  // 方案2：导航到空白页再关闭（部分浏览器可行）
                  setTimeout(() => {
                    try {
                      location.href = 'about:blank';
                      setTimeout(() => {
                        try { window.close(); } catch {}
                      }, 50);
                    } catch {}
                  }, 50);

                  // 方案3：如果无法关闭，则尝试后退一页
                  setTimeout(() => {
                    try { if (history.length > 1) history.back(); } catch {}
                  }, 120);
                } catch {}
              }}
            >
              <img
                src="/start_ui/Exit-unselected.png"
                alt="Exit"
                className="start-btn-img unselected block w-[174px] h-auto transition-opacity duration-150 opacity-100 group-hover:opacity-0"
                decoding="async"
                draggable="false"
              />
              <img
                src="/start_ui/Exit-selected.png"
                alt="Exit"
                className="start-btn-img selected absolute top-0 left-0 transition-opacity duration-150 opacity-0 group-hover:opacity-100 w-[174px] h-auto"
                decoding="async"
                draggable="false"
              />
            </button>
          </div>
        </>
      )}

      {!showStartMenu && (
      <main className="mx-auto max-w-[880px] px-6 sm:px-8 py-12 sm:py-16 relative z-10 glass-card fade-in-up ui-visible">
        {/* 顶部标题 */}
        <header className="mb-10 sm:mb-12">
          <div className="mb-6 sm:mb-8">
            <img
              src="/title.png"
              alt="魔女裁决 标题图"
              className="block mx-auto h-auto w-auto max-w-full fade-in-up float-subtle no-select title-img"
              loading="eager"
              decoding="async"
              draggable="false"
            />
          </div>

          <h1 className="text-[36px] leading-[44px] font-bold tracking-tight">
            属于艾玛众人之前在此岛上的女孩们的故事
          </h1>
          <p className="mt-3 text-[16px] leading-[24px] text-black/70">
            现支持多角色问卷：为多个角色分别填写问答，勾选要参与的角色后生成人物设定 → 大纲 → 故事。
          </p>
        </header>

        {/* 步骤指示器 */}
        <nav
          aria-label="progress"
          className="mb-10 sm:mb-12 rounded-[8px] border border-black/10 p-4 sm:p-5"
        >
          <ol className="grid grid-cols-3 items-center gap-3 text-[14px] leading-[20px]">
            <li className="flex items-center gap-3">
              <div
                className={cls(
                  "h-8 w-8 shrink-0 rounded-full border flex items-center justify-center transition-all",
                  currentStepNo >= 1 ? "bg-black text-white border-black" : "bg-transparent text-black border-black/40"
                )}
              >
                1
              </div>
              <span className={cls(currentStepNo >= 1 ? "font-semibold" : "text-black/70")}>问卷</span>
            </li>
            <li className="flex items-center gap-3">
              <div
                className={cls(
                  "h-8 w-8 shrink-0 rounded-full border flex items-center justify-center transition-all",
                  currentStepNo >= 2 ? "bg-black text-white border-black" : "bg-transparent text-black border-black/40"
                )}
              >
                2
              </div>
              <span className={cls(currentStepNo >= 2 ? "font-semibold" : "text-black/70")}>生成中</span>
            </li>
            <li className="flex items-center gap-3">
              <div
                className={cls(
                  "h-8 w-8 shrink-0 rounded-full border flex items-center justify-center transition-all",
                  currentStepNo >= 3 ? "bg-black text-white border-black" : "bg-transparent text-black border-black/40"
                )}
              >
                3
              </div>
              <span className={cls(currentStepNo >= 3 ? "font-semibold" : "text-black/70")}>结果</span>
            </li>
          </ol>
        </nav>

        {/* 内容卡片 */}
        <div className="rounded-[4px] overflow-hidden fade-in">
          {/* 表单步骤 */}
          {step === "form" && (
            <section className="p-6 sm:p-8">
              <SectionTitle>角色问卷（多角色）</SectionTitle>
              <p className="mt-2 text-black/70 text-[16px] leading-[24px]">
                每个角色都有7个固定问题。必须严格勾选12个角色，每个角色必须回答完全部7个问题才能生成故事。
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={addRole}
                  className="h-12 px-5 rounded-[4px] border border-black/25 hover:border-black active:scale-[0.99] transition-all"
                >
                  添加角色
                </button>

                <button
                  type="button"
                  onClick={showLatestOutlineFromHistory}
                  className="h-12 px-5 rounded-[4px] border border-black/25 hover:border-black active:scale-[0.99] transition-all"
                  title="查看最近一次保存的大纲（使用本机历史）"
                >
                  查看最近大纲
                </button>
                <div className="ms-auto" />

                <button
                  type="button"
                  onClick={() => {
                    // 清空所有角色的回答
                    setRoles((prev) =>
                      prev.map((r) => ({
                        ...r,
                        questions: r.questions.map((q) => ({ ...q, a: "" })),
                      }))
                    );
                  }}
                  className="h-12 px-5 rounded-[4px] border border-black/25 hover:border-black active:scale-[0.99] transition-all"
                >
                  清空所有角色回答
                </button>

                <button
                  type="button"
                  onClick={resetAll}
                  className="h-12 px-5 rounded-[4px] border border-black/25 hover:border-black active:scale-[0.99] transition-all"
                >
                  重置为单角色
                </button>

                <button
                  type="button"
                  onClick={clearCache}
                  className="h-12 px-5 rounded-[4px] border border-red-300 text-red-600 hover:border-red-500 hover:text-red-700 active:scale-[0.99] transition-all"
                  title="清除浏览器缓存的角色数据并刷新页面"
                >
                  清除缓存
                </button>
              </div>

              <div className="mt-6 grid gap-6">
                {roles.map((role, idx) => (
                  <div key={role.roleId} className="border border-black/12 shadow-sm">
                    {/* 角色头部：勾选/重命名/折叠/删除 */}
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white/70 border-b border-black/10">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={role.selected}
                          onChange={() => toggleRoleSelected(role.roleId)}
                          className="h-5 w-5 rounded border border-black/30"
                        />
                        <span className="text-[14px] leading-[20px] text-black/70">参与生成</span>
                      </label>

                      <input
                        className="flex-1 min-w-[160px] rounded-[4px] border border-black/15 bg-white/80 px-3 py-2 text-[16px] leading-[24px] outline-none focus:border-black transition-colors"
                        value={role.roleName}
                        onChange={(e) => renameRole(role.roleId, e.target.value)}
                        placeholder={`角色名称（如：${newRoleName(idx + 1)}）`}
                      />

                      <div className="ms-auto" />

                      <span className="text-[12px] leading-[16px] text-black/60">
                        已回答：{isClient ? role.questions.filter((q) => q.a.trim().length > 0).length : 0} 项
                      </span>

                      <button
                        type="button"
                        onClick={() => toggleRoleExpanded(role.roleId)}
                        className="h-10 px-4 rounded-[4px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                        aria-expanded={role.expanded}
                      >
                        {role.expanded ? "折叠" : "展开"}
                      </button>

                      <button
                        type="button"
                        onClick={() => clearAnswers(role.roleId)}
                        className="h-10 px-4 rounded-[4px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                      >
                        清空回答
                      </button>

                      <button
                        type="button"
                        onClick={() => completeRole(role.roleId)}
                        className="h-10 px-4 rounded-[4px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                        disabled={isCompleting(role.roleId) || running}
                        aria-disabled={isCompleting(role.roleId) || running}
                        title="基于已填内容进行 AI 补全，并覆盖六项输入"
                      >
                        {isCompleting(role.roleId) ? "AI补全中..." : "AI补全"}
                      </button>

                      <button
                        type="button"
                        onClick={() => removeRole(role.roleId)}
                        className="h-10 px-4 rounded-[4px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                        disabled={roles.length <= 1}
                        aria-disabled={roles.length <= 1}
                        title={roles.length <= 1 ? "至少保留一个角色" : "删除此角色"}
                      >
                        删除角色
                      </button>
                    </div>

                    {/* 角色问卷体 */}
                    {role.expanded && (
                      <div className="px-4 pb-4 bg-white/60">
                        <div className="space-y-4 divide-y divide-black/10">
                          {role.questions.map((item) => (
                            <div key={item.id} className="pt-4 first:pt-0">
                              <label className="block text-[14px] leading-[20px] font-semibold mb-2">
                                {item.q}
                              </label>

                              <textarea
                                className="w-full min-h-[96px] rounded-[4px] border border-black/15 px-4 py-3 text-[16px] leading-[24px] outline-none focus:border-black transition-colors placeholder:text-black/40"
                                placeholder={item.placeholder || "请输入你的回答"}
                                value={item.a}
                                onChange={(e) => updateA(role.roleId, item.id, e.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-6 space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="text-[14px] leading-[20px] text-black/70">
                    已选择角色：{isClient ? selectedRoles.length : 0} / 12
                  </div>
                  <div className="text-[14px] leading-[20px] text-black/70">
                    生成规则：必须严格勾选 12 个角色，每个角色必须回答完全部 7 个问题。
                  </div>
                </div>

                {isClient && selectedRoles.length === 12 && (
                  <div className="protagonist-select">
                    <label className="text-[14px] leading-[20px] font-medium">选择主人公：</label>
                    <div className="select-wrap">
                      <select
                        value={protagonist}
                        onChange={(e) => setProtagonist(e.target.value)}
                        className="select-ui"
                        aria-label="选择主人公"
                      >
                        <option value="">请选择主人公角色</option>
                        {selectedRoles.map((role) => (
                          <option key={role.roleId} value={role.roleId}>
                            {role.roleName || `角色${roles.indexOf(role) + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-4">
                  <div className="ms-auto" />
                  <button
                    type="button"
                    onClick={runWorkflow}
                    disabled={!canSubmit}
                    className={cls(
                      "h-12 px-6 rounded-[4px] border border-black bg-black text-white transition-[transform,opacity] active:scale-[0.99]",
                      canSubmit ? "hover:opacity-90" : "opacity-60 pointer-events-none"
                    )}
                    aria-disabled={!canSubmit}
                  >
                    {running ? "提交中..." : "提交并生成故事"}
                  </button>
                </div>

                {!canSubmit && (
                  <p className="mt-3 text-[14px] leading-[20px] text-black/60">
                    {selectedRoles.length !== 12
                      ? `请勾选严格 12 个角色（当前：${selectedRoles.length}）`
                      : invalidSelectedRoles.length > 0
                      ? `有 ${invalidSelectedRoles.length} 个角色未完成全部 7 个问题`
                      : !protagonist
                      ? "请选择一个主人公角色"
                      : "请检查所有条件"}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* 进度步骤 */}
          {step === "progress" && (
            <section className="p-6 sm:p-8">
              <SectionTitle>正在生成大纲</SectionTitle>
              <p className="mt-2 text-black/70">
                系统将分两步完成：人物设定（多角色 XML 提取）→ 故事大纲（XML 提取）。请稍候。
              </p>

              <div className="mt-6 grid gap-4">
                <ProgressRow
                  index={1}
                  label="人物设定（多角色 XML 提取）"
                  status={stage.profile}
                />
                <ProgressRow
                    index={2}
                    label="故事大纲（XML 提取）"
                    status={stage.outline}
                />
              </div>

              {error && (
                <div className="mt-6 rounded-[10px] border border-black/15 p-4">
                  <p className="text-[14px] leading-[20px] text-black">
                    错误：{error}
                  </p>
                  <div className="mt-4 flex gap-4">
                    <button
                      type="button"
                      onClick={runWorkflow}
                      className="h-12 px-5 rounded-[10px] border border-black/25 hover:border-black active:scale-[0.99] transition-all"
                    >
                      重试
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep("form")}
                      className="h-12 px-5 rounded-[10px] border border-black bg-black text-white active:scale-[0.99] transition-all"
                    >
                      返回修改问卷
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 结果步骤 */}
          {step === "result" && (
            <section className="p-6 sm:p-8">
              <SectionTitle>大纲与章节结构</SectionTitle>
              <p className="mt-2 text-black/70">以下是基于你勾选的角色问卷生成的故事大纲。请从第一节开始逐步创作故事。</p>

              {/* 大纲结构视图 */}
              {outlineFull && (
                <section className="mt-6 border border-black/10 p-5 sm:p-6 shadow-sm">
                  <h3 className="text-[24px] leading-[32px] font-semibold tracking-tight">章节结构</h3>
                  <div className="mt-4 space-y-4">
                    {outlineFull.chapters.map((ch, idx) => (
                      <div key={idx} className="border border-black/12 border-l-[3px] p-4 bg-white/70">
                        <h4 className="text-[18px] leading-[24px] font-semibold">{ch.chapterTitle}</h4>
                        <ol className="mt-3 divide-y divide-black/10">
                          {ch.sections.map((sec, j) => (
                            <li key={j} className="pt-2">
                              <div className="text-[14px] leading-[20px] font-semibold">{sec.sectionTitle}</div>
                              <div className="mt-1 text-[14px] leading-[20px] text-black/70">{sec.summary}</div>
                              <div className="mt-3 flex gap-3">
                                {(() => {
                                  const key = `${idx}-${j}`;
                                  const index = orderedKeys.indexOf(key);
                                  const canCreate = index >= 0 && allowCreate(key, index);
                                  const canRecreate = index >= 0 && allowRecreate(key, index);
                                  return (
                                    <>
                                      {canCreate && (
                                        <button
                                          type="button"
                                          onClick={() => generateSectionStory(idx, j, sec.sectionTitle)}
                                          className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                                          disabled={generatingKey === key}
                                          aria-disabled={generatingKey === key}
                                          title="为此节创建故事"
                                        >
                                          {generatingKey === key ? "创建中..." : "为此节创建故事"}
                                        </button>
                                      )}
                                      {canRecreate && (
                                        <button
                                          type="button"
                                          onClick={() => generateSectionStory(idx, j, sec.sectionTitle)}
                                          className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                                          disabled={generatingKey === key}
                                          aria-disabled={generatingKey === key}
                                          title="重新生成此节"
                                        >
                                          {generatingKey === key ? "重新创建中..." : "为此节重新创建故事"}
                                        </button>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                              {(() => {
                                const sKey = `${idx}-${j}`;
                                const has = sectionStories[sKey];
                                const expanded = sectionExpand[sKey] ?? false;
                                if (!has) return null;
                                return (
                                  <div className="mt-3 border border-black/10 bg-white/80">
                                    <div className="flex items-center justify-between px-3 py-2">
                                      <span className="text-[13px] leading-[18px] text-black/60">本节生成内容</span>
                                      <button
                                        type="button"
                                        onClick={() => setSectionExpand(prev => ({ ...prev, [sKey]: !expanded }))}
                                        className="h-8 px-3 rounded-[4px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                                        title={expanded ? "收起内容" : "展开内容"}
                                      >
                                        {expanded ? "收起内容" : "展开内容"}
                                      </button>
                                    </div>
                                    {expanded && (
                                      <div className="p-3 text-[14px] leading-[20px] whitespace-pre-wrap">
                                        {has}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {!outlineFull && outlineMinimal && (
                <section className="mt-6 border border-black/10 p-5 sm:p-6 shadow-sm">
                  <h3 className="text-[24px] leading-[32px] font-semibold tracking-tight">大纲结构</h3>
                  <p className="mt-2 text-[14px] leading-[20px] text-black/70">前提：{outlineMinimal.premise}</p>
                  <ol className="mt-4 divide-y divide-black/10">
                    {outlineMinimal.beats.map((b, i) => (
                      <li key={i} className="pt-2">
                        <div className="text-[14px] leading-[20px]">{b}</div>
                        <div className="mt-3 flex gap-3">
                          {(() => {
                            const key = `0-${i}`;
                            const index = orderedKeys.indexOf(key);
                            const canCreate = index >= 0 && allowCreate(key, index);
                            const canRecreate = index >= 0 && allowRecreate(key, index);
                            return (
                              <>
                                {canCreate && (
                                  <button
                                    type="button"
                                    onClick={() => generateSectionStory(0, i, `第${i + 1}节`)}
                                    className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                                    disabled={generatingKey === key}
                                    aria-disabled={generatingKey === key}
                                    title="为此节创建故事"
                                  >
                                    {generatingKey === key ? "创建中..." : "为此节创建故事"}
                                  </button>
                                )}
                                {canRecreate && (
                                  <button
                                    type="button"
                                    onClick={() => generateSectionStory(0, i, `第${i + 1}节`)}
                                    className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                                    disabled={generatingKey === key}
                                    aria-disabled={generatingKey === key}
                                    title="重新生成此节"
                                  >
                                    {generatingKey === key ? "重新创建中..." : "为此节重新创建故事"}
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        {(() => {
                          const sKey = `0-${i}`;
                          const has = sectionStories[sKey];
                          const expanded = sectionExpand[sKey] ?? false;
                          if (!has) return null;
                          return (
                            <div className="mt-3 border border-black/10 bg-white/80">
                              <div className="flex items-center justify-between px-3 py-2">
                                <span className="text-[13px] leading-[18px] text-black/60">本节生成内容</span>
                                <button
                                  type="button"
                                  onClick={() => setSectionExpand(prev => ({ ...prev, [sKey]: !expanded }))}
                                  className="h-8 px-3 rounded-[4px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                                  title={expanded ? "收起内容" : "展开内容"}
                                >
                                  {expanded ? "收起内容" : "展开内容"}
                                </button>
                              </div>
                              {expanded && (
                                <div className="p-3 text-[14px] leading-[20px] whitespace-pre-wrap">
                                  {has}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setShowOutlineHistory((v) => !v)}
                  className="h-12 px-5 rounded-[10px] border border-black/25 hover:border-black active:scale-[0.99] transition-all"
                  title={showOutlineHistory ? "隐藏大纲历史" : "显示大纲历史"}
                >
                  {showOutlineHistory ? "隐藏大纲历史" : "显示大纲历史"}
                </button>
                <div className="ms-auto" />
                <button
                  type="button"
                  onClick={resetAll}
                  className="h-12 px-6 rounded-[10px] border border-black bg-black text-white transition-[transform,opacity] active:scale-[0.99] hover:opacity-90"
                >
                  重新开始
                </button>
              </div>

              {showOutlineHistory && (
                <section className="mt-6 border border-black/10 p-5 sm:p-6 shadow-sm">
                  <header className="mb-4">
                    <h3 className="text-[22px] leading-[28px] font-semibold">大纲历史</h3>
                    <p className="mt-2 text-black/70 text-[14px] leading-[20px]">
                      列出本机浏览器中保存的故事大纲（XML）。历史存储使用 localStorage。
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={refreshOutlineHistory}
                        className="h-10 px-4 rounded-[8px] border border-black/20 hover:border-black active:scale-[0.99] transition-transform"
                        title="刷新历史列表"
                      >
                        刷新
                      </button>
                      <button
                        type="button"
                        onClick={clearOutlineHistoryAndRefresh}
                        className="h-10 px-4 rounded-[8px] border border-red-300 text-red-600 hover:border-red-500 hover:text-red-700 active:scale-[0.99] transition-transform"
                        title="清空历史（本机浏览器）"
                      >
                        清空历史
                      </button>
                    </div>
                  </header>

                  {historyList.length === 0 ? (
                    <div className="rounded-[10px] border border-black/12 p-4">
                      <p className="text-[14px] leading-[20px] text-black/70">暂无历史记录。</p>
                    </div>
                  ) : (
                    <section>
                      {historyList.map((entry) => (
                        <OutlineCard key={entry.id} entry={entry} onLoad={loadHistoryEntry} onCreateSection={loadAndCreateSection} />
                      ))}
                    </section>
                  )}
                </section>
              )}
            </section>
          )}
        </div>
      </main>
      )}
    </div>
  );
}

function ProgressRow({
  index,
  label,
  status,
}: {
  index: number;
  label: string;
  status: StageStatus;
}) {
  const isRunning = status === "running";
  const isDone = status === "done";
  const isError = status === "error";

  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-black/12 px-4 py-3">
      <div
        className={cls(
          "h-8 w-8 shrink-0 rounded-full border flex items-center justify-center text-[14px] leading-[20px]",
          isDone
            ? "bg-black text-white border-black"
            : isError
            ? "bg-transparent text-black border-black"
            : "bg-transparent text-black border-black/40"
        )}
      >
        {index}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <p className="text-[16px] leading-[24px]">{label}</p>
          {isRunning && <SpinnerDot active />}
          {isDone && (
            <span className="text-[12px] leading-[16px] text-black/60">完成</span>
          )}
          {isError && (
            <span className="text-[12px] leading-[16px] text-black/60">失败</span>
          )}
        </div>
      </div>
    </div>
  );
}
