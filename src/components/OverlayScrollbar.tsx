"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 覆盖原生滚动条的“悬浮滚动条”（不占用布局宽度）
 * - 始终隐藏原生滚动条（通过 globals.css 配置）
 * - 该控件固定在右侧，随页面高度变化计算拇指位置与大小
 * - 支持：
 *   - 点击轨道：跳转至对应位置
 *   - 拖拽拇指：精确滚动
 * - 叠层：z-[55]（低于右上角插头的小眼睛/插头 z-[60]，高于主体）
 * - 在无滚动内容时自动隐藏（opacity 0 + pointer-events: none）
 * - 标记 ui-visible：在“peek-hide（仅看背景）”模式下会被隐藏，不改变布局宽度
 */
export default function OverlayScrollbar() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackH, setTrackH] = useState<number>(0);
  const [thumbH, setThumbH] = useState<number>(48);
  const [thumbTop, setThumbTop] = useState<number>(0);
  const [visible, setVisible] = useState<boolean>(false);
  const [enabled, setEnabled] = useState<boolean>(false);
  const draggingRef = useRef<{
    active: boolean;
    startY: number;
    startThumbTop: number;
  }>({ active: false, startY: 0, startThumbTop: 0 });

  const getDoc = () => document.documentElement;

  // 重新计算尺寸与位置
  const recalc = useCallback(() => {
    try {
      const doc = getDoc();
      const track = trackRef.current;
      if (!track) return;

      const scrollH = doc.scrollHeight;
      const clientH = doc.clientHeight;
      const sTop = doc.scrollTop || window.scrollY || 0;

      const tH = track.clientHeight;
      setTrackH(tH);

      const needScroll = scrollH > clientH + 2;
      setVisible(needScroll);

      if (!needScroll) {
        setThumbH(48);
        setThumbTop(0);
        return;
      }

      // 计算拇指高度（最小 36）
      const minThumb = 36;
      const calcThumb = Math.max((clientH / scrollH) * tH, minThumb);
      const maxThumbTop = Math.max(tH - calcThumb, 0);

      // 计算拇指位置
      const ratio = sTop / Math.max(scrollH - clientH, 1);
      const calcTop = Math.min(Math.max(ratio * (tH - calcThumb), 0), maxThumbTop);

      setThumbH(calcThumb);
      setThumbTop(calcTop);
    } catch {}
  }, []);

  // 窗口滚动/尺寸变化时更新
  useEffect(() => {
    const onScroll = () => {
      // 使用 rAF 降频
      requestAnimationFrame(recalc);
    };
    const onResize = () => {
      requestAnimationFrame(recalc);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    // 初始计算（延后以等待布局稳定）
    const t = setTimeout(recalc, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [recalc]);

  // 根据 body 是否含 start-phase 类，决定是否启用滚动条（初始页面不显示）
  useEffect(() => {
    const check = () => {
      try {
        const b = document.body;
        setEnabled(!b.classList.contains("start-phase"));
      } catch {}
    };
    check();
    let obs: MutationObserver | null = null;
    try {
      obs = new MutationObserver(check);
      obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    } catch {}
    return () => { try { obs?.disconnect(); } catch {} };
  }, []);

  // 轨道点击跳转
  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    try {
      if (!trackRef.current) return;
      if ((e.target as HTMLElement).dataset.thumb === "true") {
        // 点击到了拇指，不处理（拖拽逻辑负责）
        return;
      }
      const doc = getDoc();
      const rect = trackRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top; // 点击相对轨道的 Y
      const tH = trackRef.current.clientHeight;

      const scrollH = doc.scrollHeight;
      const clientH = doc.clientHeight;

      // 期望的 thumbTop = y - thumbH/2
      const targetThumbTop = Math.min(
        Math.max(y - thumbH / 2, 0),
        Math.max(tH - thumbH, 0)
      );
      const ratio = targetThumbTop / Math.max(tH - thumbH, 1);
      const targetScrollTop = ratio * Math.max(scrollH - clientH, 1);

      window.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    } catch {}
  };

  // 开始拖拽
  const onThumbMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    try {
      e.preventDefault();
      draggingRef.current.active = true;
      draggingRef.current.startY = e.clientY;
      draggingRef.current.startThumbTop = thumbTop;
      // 更换光标
      document.body.style.cursor = "grabbing";
      // 阻止选择
      document.body.style.userSelect = "none";
    } catch {}
  };

  // 拖拽过程中
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const dragging = draggingRef.current;
      if (!dragging.active || !trackRef.current) return;
      try {
        const dy = ev.clientY - dragging.startY;
        const tH = trackRef.current.clientHeight;
        const nextThumbTop = Math.min(
          Math.max(dragging.startThumbTop + dy, 0),
          Math.max(tH - thumbH, 0)
        );

        // thumbTop -> scrollTop 映射
        const doc = getDoc();
        const scrollH = doc.scrollHeight;
        const clientH = doc.clientHeight;

        const ratio = nextThumbTop / Math.max(tH - thumbH, 1);
        const targetScrollTop = ratio * Math.max(scrollH - clientH, 1);

        window.scrollTo({ top: targetScrollTop, behavior: "auto" });
        // 立即更新 UI（避免滚动事件延迟导致拇指跟随感不强）
        setThumbTop(nextThumbTop);
      } catch {}
    };
    const onUp = () => {
      if (!draggingRef.current.active) return;
      draggingRef.current.active = false;
      // 恢复光标与选择
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // 最终对齐一次
      requestAnimationFrame(recalc);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [thumbH, recalc]);

  const containerStyle: React.CSSProperties = {
    opacity: enabled && visible ? 1 : 0,
    pointerEvents: enabled && visible ? "auto" : "none",
    transition: "opacity 220ms ease",
  };

  if (!enabled) return null;

  return (
    <div
      className="ui-visible fixed top-4 right-3 bottom-4 w-2 z-[55] select-none"
      style={containerStyle}
      aria-hidden={!enabled || !visible}
    >
      <div
        ref={trackRef}
        className="relative h-full w-full rounded-full bg-transparent hover:bg-transparent transition-colors"
        onClick={onTrackClick}
        role="presentation"
        aria-label="自定义滚动条轨道"
      >
        <div
          data-thumb="true"
          role="scrollbar"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="自定义滚动条拇指"
          onMouseDown={onThumbMouseDown}
          className="absolute left-0 right-0 rounded-full bg-black/50 hover:bg-black/70 shadow-[0_1px_6px_rgba(0,0,0,0.25)] cursor-pointer"
          style={{ height: `${thumbH}px`, top: `${thumbTop}px` }}
        />
      </div>
    </div>
  );
}