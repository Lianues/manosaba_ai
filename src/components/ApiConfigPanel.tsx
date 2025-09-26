"use client";

import { useEffect, useState } from "react";

/**
 * 右上角 API 配置插头按钮 + 配置面板
 * - 持久化：存储在浏览器 localStorage（键：manosaba_ai.api_config）
 * - 后端不再读取 .env 或进程环境变量；每次请求均从请求头 x-ai-* 动态获取配置
 * - UI 规范：黑白极简、4/8pt 间距、圆角不超过 4px、微交互
 * - 触控友好：按钮尺寸 ≥ 48×48
 */

type EnvState = {
  AI_API_KEY: string;
  AI_BASE_URL: string;
  AI_MODEL_ID: string;
};

type LoadStatus = "idle" | "loading" | "ok" | "error";
type SaveStatus = "idle" | "saving" | "ok" | "error";

function cls(...xs: Array<string | false | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function ApiConfigPanel() {
  const [open, setOpen] = useState(false);
  const [env, setEnv] = useState<EnvState>({
    AI_API_KEY: "",
    AI_BASE_URL: "",
    AI_MODEL_ID: "",
  });
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 小眼睛悬停隐藏 UI 状态
  const [peekHide, setPeekHide] = useState(false);
  // 初始页面隐藏 API 插头按钮与小眼睛：根据 body 上的 start-phase 类动态切换
  const [hidePlug, setHidePlug] = useState(false);
  const [hideEye, setHideEye] = useState(false);
  // 初始页面隐藏“房子”返回按钮（正式页面显示）
  const [hideHome, setHideHome] = useState(false);

  // 打开面板时从浏览器 localStorage 加载当前配置
  useEffect(() => {
    if (!open) return;
    setLoadStatus("loading");
    setErrorMsg(null);
    try {
      const raw = localStorage.getItem("manosaba_ai.api_config");
      const parsed = raw ? JSON.parse(raw) : null;
      const next: EnvState = {
        AI_API_KEY: parsed?.AI_API_KEY ?? "",
        AI_BASE_URL: parsed?.AI_BASE_URL ?? "",
        AI_MODEL_ID: parsed?.AI_MODEL_ID ?? "",
      };
      setEnv(next);
      setLoadStatus("ok");
    } catch (e: any) {
      setLoadStatus("error");
      setErrorMsg(e?.message ?? "未知错误");
    }
  }, [open]);

  function onChange(key: keyof EnvState, val: string) {
    setEnv((prev) => ({ ...prev, [key]: val }));
  }

  function save() {
    setSaveStatus("saving");
    setErrorMsg(null);
    try {
      localStorage.setItem("manosaba_ai.api_config", JSON.stringify(env));
      setSaveStatus("ok");
      // 1.6 秒后自动关闭
      setTimeout(() => {
        setSaveStatus("idle");
        setOpen(false);
        // 广播前端配置更新事件
        try { window.dispatchEvent(new CustomEvent("api:configUpdated")); } catch {}
      }, 1600);
    } catch (e: any) {
      setSaveStatus("error");
      setErrorMsg(e?.message ?? "未知错误");
    }
  }

  // 切换全局隐藏 UI 的 body 类（仅保留背景层）
  useEffect(() => {
    try {
      const b = document.body;
      if (peekHide) b.classList.add("peek-hide");
      else b.classList.remove("peek-hide");
      return () => b.classList.remove("peek-hide");
    } catch {}
  }, [peekHide]);

  // 监听 body.class 的变化以检测 start-phase 状态，控制是否隐藏 API 插头按钮、小眼睛与房子
  useEffect(() => {
    try {
      const b = document.body;
      const update = () => {
        const sp = b.classList.contains("start-phase");
        setHidePlug(sp);
        setHideEye(sp);
        setHideHome(sp);
      };
      update();
      const mo = new MutationObserver(update);
      mo.observe(b, { attributes: true, attributeFilter: ["class"] });
      return () => mo.disconnect();
    } catch {}
  }, []);

  return (
    <>
      {/* 右上角：插头按钮 + 小眼睛（悬停隐藏 UI） */}
      <div className="fixed top-4 right-4 z-[60] flex items-center gap-2">
        {/* 房子按钮（初始页面隐藏；正式页面显示；位于 API 配置按钮左侧） */}
        {!hideHome && (
          <div className="ui-visible">
            <button
              type="button"
              aria-label="回到初始页面"
              title="回到初始页面"
              onClick={() => {
                try {
                  // 通知首页切换到初始菜单（无需整页刷新）
                  window.dispatchEvent(new CustomEvent("app:goHome"));
                } catch {}
              }}
              className={cls(
                "h-12 w-12 min-h-12 min-w-12 rounded-[4px] border border-black/25 bg-white text-black",
                "flex items-center justify-center",
                "transition-transform active:scale-[0.98]",
                "shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
                "no-select"
              )}
            >
              {/* 极简房子图标（黑白） */}
              <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" className="block">
                <path d="M3 11l9-7 9 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5 10v9h14v-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 19v-6h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}
        {/* 插头按钮（初始页面隐藏，仅保留小眼睛；进入游戏后显示） */}
        {!hidePlug && (
          <div className="ui-visible">
            <button
              type="button"
              aria-label="API 配置"
              title="API 配置"
              onClick={() => setOpen(true)}
              className={cls(
                "h-12 w-12 min-h-12 min-w-12 rounded-[4px] border border-black/25 bg-white text-black",
                "flex items-center justify-center",
                "transition-transform active:scale-[0.98]",
                "shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
                "no-select"
              )}
            >
              {/* 极简插头 SVG 图标（黑白） */}
              <svg
                aria-hidden
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                className="block"
              >
                {/* 线条仅使用黑色 */}
                <path
                  d="M7 6v5a5 5 0 0 0 5 5h0a5 5 0 0 0 5-5V6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M9 2v4M15 2v4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M12 16v4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}

        {/* 小眼睛按钮区域（初始页面隐藏；正式页面显示） */}
        {!hideEye && (
          <div className="relative h-12 w-12">
            {!peekHide ? (
              <button
                type="button"
                aria-label="预览背景（悬停隐藏UI）"
                title="将鼠标移入以隐藏全部界面，仅保留背景"
                onMouseEnter={() => setPeekHide(true)}
                className={cls(
                  "h-12 w-12 min-h-12 min-w-12 rounded-[4px] border border-black/25 bg-white text-black",
                  "flex items-center justify-center",
                  "transition-transform active:scale-[0.98]",
                  "shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
                  "ui-visible",
                  "no-select"
                )}
              >
                {/* 极简小眼睛 SVG 图标（黑白） */}
                <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" className="block">
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            ) : (
              <div
                className="h-12 w-12 no-select cursor-default"
                onMouseLeave={() => setPeekHide(false)}
                aria-hidden
                tabIndex={-1}
              />
            )}
          </div>
        )}
      </div>

      {/* 配置面板（打开时显示） */}
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center ui-visible"
          role="dialog"
          aria-modal="true"
        >
          {/* 背景柔白玻璃态遮罩 */}
          <div
            className="absolute inset-0 bg-white/70 backdrop-blur-[6px]"
            onClick={() => setOpen(false)}
          />

          {/* 面板容器：遵循圆角 ≤ 4px、黑白极简、4/8pt 间距 */}
          <div className="relative w-[92%] max-w-[640px] rounded-[4px] border border-black/15 bg-white text-black p-6 shadow-[0_10px_28px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between">
              <h2 className="text-[28px] leading-[36px] font-semibold tracking-tight">API 配置</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="h-10 px-4 rounded-[4px] border border-black/20 bg-white active:scale-[0.98] transition-transform"
              >
                关闭
              </button>
            </div>

            <p className="mt-2 text-[16px] leading-[24px] text-black/70">
              配置将存储到本机浏览器 localStorage，仅对你本人生效，不影响他人。后端调用将随请求头动态使用你的配置。
            </p>

            <div className="mt-6 grid gap-6">
              {/* AI_API_KEY */}
              <div>
                <label className="block text-[14px] leading-[20px] font-medium mb-2">
                  AI_API_KEY
                </label>
                <input
                  className="w-full rounded-[4px] border border-black/15 px-4 py-3 text-[16px] leading-[24px] outline-none focus:border-black transition-colors"
                  value={env.AI_API_KEY}
                  placeholder="必填：你的 API Key（仅黑白文本）"
                  onChange={(e) => onChange("AI_API_KEY", e.target.value)}
                />
              </div>

              {/* AI_BASE_URL */}
              <div>
                <label className="block text-[14px] leading-[20px] font-medium mb-2">
                  AI_BASE_URL
                </label>
                <input
                  className="w-full rounded-[4px] border border-black/15 px-4 py-3 text-[16px] leading-[24px] outline-none focus:border-black transition-colors"
                  value={env.AI_BASE_URL}
                  placeholder="必填：完整的 chat/completions 接口 URL"
                  onChange={(e) => onChange("AI_BASE_URL", e.target.value)}
                />
                <p className="mt-2 text-[12px] leading-[16px] text-black/60">
                  例如： https://api.openai.com/v1/chat/completions
                </p>
              </div>

              {/* AI_MODEL_ID */}
              <div>
                <label className="block text-[14px] leading-[20px] font-medium mb-2">
                  AI_MODEL_ID
                </label>
                <input
                  className="w-full rounded-[4px] border border-black/15 px-4 py-3 text-[16px] leading-[24px] outline-none focus:border-black transition-colors"
                  value={env.AI_MODEL_ID}
                  placeholder="必填：模型 ID（如 gpt-4o-mini / meta-llama/llama-3.1-...）"
                  onChange={(e) => onChange("AI_MODEL_ID", e.target.value)}
                />
              </div>
            </div>

            {/* 状态与动作 */}
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <div className="text-[14px] leading-[20px] text-black/70">
                {loadStatus === "loading" && "正在读取浏览器配置…"}
                {loadStatus === "error" && "读取失败，请重试。"}
                {saveStatus === "saving" && "正在保存到浏览器…"}
                {saveStatus === "ok" && "保存成功（已写入浏览器 localStorage）。"}
                {saveStatus === "error" && "保存失败，请检查字段格式。"}
              </div>

              <div className="ms-auto" />

              <button
                type="button"
                onClick={save}
                disabled={saveStatus === "saving"}
                className={cls(
                  "h-12 px-6 rounded-[4px] border border-black bg-black text-white transition-[transform,opacity] active:scale-[0.98]",
                  saveStatus === "saving" ? "opacity-60 pointer-events-none" : "hover:opacity-90"
                )}
              >
                {saveStatus === "saving" ? "保存中…" : "保存并应用"}
              </button>
            </div>

            {errorMsg && (
              <div className="mt-4 rounded-[4px] border border-black/15 p-4">
                <p className="text-[14px] leading-[20px] text-black">错误：{errorMsg}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}