"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

interface Track {
  file: string;
  name: string;
  src: string;
}

type PlayMode = "list" | "single" | "shuffle";

const MUSIC_PREFIX = "/music/";
const STORAGE_KEY = "manosaba_ai.music_player";
const START_HIDE_KEY = "manosaba_ai.start_audio_hidden"; // 下轮隐藏：下次进入初始页时隐藏一次（页面加载后自动清除）

function stripExt(file: string) {
  const idx = file.lastIndexOf(".");
  return idx > 0 ? file.slice(0, idx) : file;
}

function formatTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${mm}:${ss}`;
}

function randInt(max: number) {
  return Math.floor(Math.random() * max);
}

/**
 * 生成“伪随机”播放顺序：
 * - 使用 Fisher-Yates 打乱
 * - 避免首元素与 avoid 相同，减少短期重复
 */
function genShuffleOrder(n: number, avoid?: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (typeof avoid === "number" && n > 1 && arr[0] === avoid) {
    // 将首元素与下一个交换，避免与上次歌曲重复
    [arr[0], arr[1]] = [arr[1], arr[0]];
  }
  return arr;
}

export default function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [idx, setIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [autoPlayPref, setAutoPlayPref] = useState<boolean>(false);

  // 初始页面隐藏音频组件（仅本轮，直到刷新）
  const [isStartPhase, setIsStartPhase] = useState<boolean>(false);
  const [startAudioHidden, setStartAudioHidden] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [dragging, setDragging] = useState<boolean>(false);
  const [showList, setShowList] = useState<boolean>(false);
  const [showVolume, setShowVolume] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  // 折叠状态：收起后仅显示一个向上箭头用于展开
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // 播放模式：列表循环 / 单曲循环 / 随机播放
  const [mode, setMode] = useState<PlayMode>("list");

  // 随机播放序列与当前位置（避免短期重复）
  const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);
  const [shufflePos, setShufflePos] = useState<number>(0);

  // 切歌后是否恢复历史进度（仅在首屏恢复时为 true，手动或自动切歌为 false）
  const restoreTimeRef = useRef<boolean>(true);

  // 最近播放的最后一首（用于避免新序列首元素与之相同）
  const lastPlayedRef = useRef<number | null>(null);
  // 首次自动开始播放的一次性标记，避免 UI 就绪时重复触发播放导致“重播”
  const autoStartedRef = useRef<boolean>(false);

  // fallback track list from public/music
  const fallbackFiles = useMemo(() => ["bloom.mp3", "gDie Divil JIO.mp3"], []);

  // initialize track list
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const res = await fetch(`/api/music`, { cache: "no-store" });
        if (res.ok) {
          const files: string[] = await res.json();
          const list = files.map((f) => ({
            file: f,
            name: stripExt(f),
            src: `${MUSIC_PREFIX}${f}`,
          }));
          if (active) setTracks(list);
        } else {
          throw new Error("music api not found");
        }
      } catch {
        const list = fallbackFiles.map((f) => ({
          file: f,
          name: stripExt(f),
          src: `${MUSIC_PREFIX}${f}`,
        }));
        if (active) setTracks(list);
      }
    }
    init();
    return () => {
      active = false;
    };
  }, [fallbackFiles]);

  // load persisted: track index + collapsed state + autoplay preference
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.idx === "number") setIdx(saved.idx);
      if (typeof saved.collapsed === "boolean") setCollapsed(saved.collapsed);
      if (typeof saved.autoplay === "boolean") setAutoPlayPref(saved.autoplay);
    } catch {}
  }, []);
// 监听 body.class 以识别初始页面（start-phase）
useEffect(() => {
  try {
    const b = document.body;
    const update = () => setIsStartPhase(b.classList.contains("start-phase"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(b, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  } catch {}
}, []);

 // 读取“下轮隐藏”标记：若存在则本次初始页隐藏音频组件；随后立即清除（仅隐藏一次）
useEffect(() => {
  try {
    const mark = sessionStorage.getItem(START_HIDE_KEY);
    setStartAudioHidden(mark === "1");
    // 页面加载后立即清除标记，确保只隐藏一次
    sessionStorage.removeItem(START_HIDE_KEY);
  } catch {}
}, []);

  // persist: track index + collapsed state + autoplay preference
  useEffect(() => {
    try {
      const data = { idx, collapsed, autoplay: autoPlayPref };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }, [idx, collapsed, autoPlayPref]);

  // 当曲目集合或模式变化时，维护随机序列
  useEffect(() => {
    const n = tracks.length;
    if (mode !== "shuffle" || n <= 0) return;

    // 如果现有随机序列与长度不匹配或为空，则重建
    if (shuffleOrder.length !== n || shuffleOrder.length === 0) {
      const avoid = lastPlayedRef.current ?? idx;
      const order = genShuffleOrder(n, avoid);
      setShuffleOrder(order);
      // 将位置对齐到当前 idx 所在处
      const p = order.indexOf(idx);
      setShufflePos(p >= 0 ? p : 0);
      return;
    }

    // 保证当前位置与 idx 对齐
    const pos = shuffleOrder.indexOf(idx);
    if (pos !== -1 && pos !== shufflePos) {
      setShufflePos(pos);
    }
  }, [tracks, mode, idx]);

  // ensure audio src updates when track or list ready
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || tracks.length === 0) return;
    const t = tracks[Math.min(Math.max(idx, 0), tracks.length - 1)];
    if (!t) return;

    const needLoad = audio.src !== location.origin + t.src;
    if (needLoad) {
      audio.src = t.src;
    }

    const onLoaded = () => {
      setDuration(audio.duration || 0);
      // 始终从头播放
      try { audio.currentTime = 0; } catch {}
      setCurrentTime(0);
      // 应用音量
      audio.volume = Math.min(Math.max(volume, 0), 1);
      // 勾选“默认播放音乐”后，重新进入页面尝试自动播放（可能被浏览器拦截）
      try {
        const b = document.body;
        if (!b.classList.contains("initial-black")) {
          if (autoPlayPref && !autoStartedRef.current) {
            audio.play().catch(() => {});
            autoStartedRef.current = true;
            setIsPlaying(true);
          } else if (isPlaying) {
            // 已处于播放状态时，切歌后继续播放
            audio.play().catch(() => {});
          }
        }
      } catch {}
    };
    audio.addEventListener("loadedmetadata", onLoaded, { once: true });
    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
    };
  }, [tracks, idx]);

  // 当页面进入 initial-ready（背景加载完且初始黑屏消失）后：若已勾选默认播放则尝试自动播放
  useEffect(() => {
    try {
      const b = document.body;
      const audio = audioRef.current;
      const update = () => {
        if (!b.classList.contains("initial-black") && audio && !autoStartedRef.current) {
          try { audio.currentTime = 0; } catch {}
          if (autoPlayPref) {
            audio.play().catch(() => {});
            setIsPlaying(true);
          }
          autoStartedRef.current = true;
        }
      };
      update();
      const mo = new MutationObserver(update);
      mo.observe(b, { attributes: true, attributeFilter: ["class"] });
      return () => mo.disconnect();
    } catch {}
  }, [autoPlayPref]);

  // timeupdate & ended
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (!dragging) setCurrentTime(audio.currentTime || 0);
      setDuration(audio.duration || 0);
    };
    const onEnd = () => {
      // 更新“最近播放”记录
      lastPlayedRef.current = idx;

      if (mode === "single") {
        // 单曲循环：回到0并继续播放
        try {
          audio.currentTime = 0;
          setCurrentTime(0);
          if (isPlaying) {
            audio.play().catch(() => setIsPlaying(false));
          }
        } catch {}
        return;
      }
      // 其他模式：使用“下一首”逻辑
      handleNext(true);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
    };
  }, [dragging, mode, idx, isPlaying]);

  // play/pause toggle
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const b = document.body;
    // 黑屏存在期间不触发播放/暂停；黑屏消失后再应用当前状态
    if (b.classList.contains("initial-black")) return;
    if (isPlaying) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  // volume apply
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.min(Math.max(volume, 0), 1);
  }, [volume]);

  function handlePlayPause() {
    setIsPlaying((v) => !v);
  }

  function handlePrev(auto = false) {
    // 切歌后从头播放，不恢复百分比
    restoreTimeRef.current = false;
    setCurrentTime(0);
    const audio = audioRef.current;
    if (audio) audio.currentTime = 0;

    const n = tracks.length;
    if (n === 0) return;

    if (mode === "shuffle" && shuffleOrder.length === n) {
      // 在随机序列中后退
      let pos = shuffleOrder.indexOf(idx);
      if (pos === -1) pos = shufflePos;
      if (pos > 0) {
        const nextIdx = shuffleOrder[pos - 1];
        setIdx(nextIdx);
        setShufflePos(pos - 1);
      } else {
        // 序列起点时后退：重建序列并跳到最后一个（避免立即重复）
        const order = genShuffleOrder(n, lastPlayedRef.current ?? idx);
        setShuffleOrder(order);
        setIdx(order[order.length - 1]);
        setShufflePos(order.length - 1);
      }
    } else {
      // 列表或单曲（手动）后退：正常序列
      setIdx((i) => (i - 1 + n) % n);
    }

    // 自动切歌或手动切歌后均继续播放
    setIsPlaying(true);
  }

  function handleNext(auto = false) {
    // 切歌后从头播放，不恢复百分比
    restoreTimeRef.current = false;
    setCurrentTime(0);
    const audio = audioRef.current;
    if (audio) audio.currentTime = 0;

    const n = tracks.length;
    if (n === 0) return;

    if (mode === "shuffle" && shuffleOrder.length === n) {
      // 在随机序列中前进
      let pos = shuffleOrder.indexOf(idx);
      if (pos === -1) pos = shufflePos;
      if (pos + 1 < shuffleOrder.length) {
        const nextIdx = shuffleOrder[pos + 1];
        setIdx(nextIdx);
        setShufflePos(pos + 1);
      } else {
        // 序列末尾：重建新序列，避免与上一首重复
        const order = genShuffleOrder(n, lastPlayedRef.current ?? idx);
        setShuffleOrder(order);
        setIdx(order[0]);
        setShufflePos(0);
      }
    } else {
      // 列表或单曲（手动）前进：正常序列
      setIdx((i) => (i + 1) % n);
    }

    // 自动切歌或手动切歌后均继续播放
    setIsPlaying(true);
  }

  function handleSelect(index: number) {
    restoreTimeRef.current = false;
    setCurrentTime(0);
    const audio = audioRef.current;
    if (audio) audio.currentTime = 0;

    setIdx(index);

    // 在随机模式下，将随机序列位置对齐到选中的曲目
    if (mode === "shuffle") {
      const n = tracks.length;
      if (n > 0) {
        let order = shuffleOrder;
        if (order.length !== n || order.indexOf(index) === -1) {
          order = genShuffleOrder(n, lastPlayedRef.current ?? idx);
          setShuffleOrder(order);
        }
        const p = order.indexOf(index);
        setShufflePos(p >= 0 ? p : 0);
      }
    }

    setIsPlaying(true);
  }

  // 播放进度拖动
  function seekToFraction(frac: number) {
    const audio = audioRef.current;
    if (!audio || !isFinite(duration) || duration <= 0) return;
    const clamped = Math.min(Math.max(frac, 0), 1);
    const target = clamped * duration;
    audio.currentTime = target;
    setCurrentTime(target);
  }

  function onProgressMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    try {
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const frac = (e.clientX - rect.left) / Math.max(rect.width, 1);
      setDragging(true);
      seekToFraction(frac);
      const onMove = (ev: MouseEvent) => {
        const r = rect;
        const f = (ev.clientX - r.left) / Math.max(r.width, 1);
        seekToFraction(f);
      };
      const onUp = () => {
        setDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    } catch {}
  }

  // 音量拖动
  function setVolumeByFraction(frac: number) {
    const clamped = Math.min(Math.max(frac, 0), 1);
    setVolume(clamped);
    const audio = audioRef.current;
    if (audio) audio.volume = clamped;
  }

  function onVolumeMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    try {
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const frac = (e.clientX - rect.left) / Math.max(rect.width, 1);
      setVolumeByFraction(frac);
      const onMove = (ev: MouseEvent) => {
        const r = rect;
        const f = (ev.clientX - r.left) / Math.max(r.width, 1);
        setVolumeByFraction(f);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    } catch {}
  }

   // 本轮隐藏：立即隐藏当前初始页音频（刷新后恢复显示）
  function hideForThisRound() {
    try {
      // 使用一个临时的内存标记，不写入 sessionStorage（避免刷新后仍隐藏）
      setStartAudioHidden(true);
    } catch {}
  }
  
  // 下轮隐藏：点击后将在“下次进入初始页”时隐藏一次（随后自动恢复显示）
  function hideForNextRound() {
    try {
      // 将标记写入 sessionStorage，供下一次页面加载时读取；加载后会自动清除
      sessionStorage.setItem(START_HIDE_KEY, "1");
    } catch {}
  }

  // 模式切换（单按钮循环：列表 -> 单曲 -> 随机 -> 列表）
  function toggleMode() {
    setMode((m) => {
      const next = m === "list" ? "single" : m === "single" ? "shuffle" : "list";
      // 进入随机模式时，构建序列并对齐当前位置
      if (next === "shuffle") {
        const n = tracks.length;
        if (n > 0) {
          const order = genShuffleOrder(n, lastPlayedRef.current ?? idx);
          setShuffleOrder(order);
          const p = order.indexOf(idx);
          setShufflePos(p >= 0 ? p : 0);
        }
      }
      return next;
    });
  }

  const current = tracks[idx];
  const progressFrac = duration > 0 ? currentTime / duration : 0;
  const barWidth = `${Math.min(Math.max(progressFrac * 100, 0), 100)}%`;
  const volWidth = `${Math.min(Math.max(volume * 100, 0), 100)}%`;

  // 模式图标与标签
  const modeIcon =
    mode === "list" ? "🔁" : mode === "single" ? "🔂" : "🔀";
  const modeLabel =
    mode === "list" ? "列表循环" : mode === "single" ? "单曲循环" : "随机播放";

  // 若处于初始页面且选择了隐藏，则仅隐藏UI面板但保留音频元素以继续执行默认配置（如自动播放）
  const hideUi = isStartPhase && startAudioHidden;

  return (
    <div className="ui-visible fixed bottom-3 right-3 z-[58] select-none" aria-label="音乐播放控制">
      {!hideUi && (collapsed ? (
        // 收起态：仅显示一个向上箭头用于展开
        <button
          aria-label="展开音乐播放器"
          title="展开音乐播放器"
          className="h-8 w-8 rounded-[4px] border border-black/25 bg-white hover:bg-white active:bg-white text-black active:scale-[0.98] transition-transform no-select shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
          onClick={() => setCollapsed(false)}
        >
          ▲
        </button>
      ) : (
        <div className="glass-card rounded-[4px] border border-black/25 bg-white text-black w-[360px] shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          <div className="p-3">
            {/* 标题独立一行 */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[16px] leading-6 font-semibold truncate">
                  {current ? current.name : "无可用音乐"}
                </div>
              </div>
              {/* 右侧控制：初始页的一键隐藏（本轮） + 收起按钮 */}
              <div className="flex items-center gap-2">
                {isStartPhase && !startAudioHidden && (
                  <>
                    <button
                      aria-label="本轮隐藏：立即隐藏初始页音频（刷新后恢复）"
                      title="本轮隐藏：立即隐藏初始页音频（刷新后恢复）"
                      className="h-8 px-2 rounded-[4px] border border-black/25 bg-white hover:bg-black/5 active:scale-[0.98] transition-transform no-select text-[12px] leading-5"
                      onClick={hideForThisRound}
                    >
                      本轮隐藏
                    </button>
                    <button
                      aria-label="下轮隐藏：下次进入初始页时隐藏一次（随后自动恢复）"
                      title="下轮隐藏：下次进入初始页时隐藏一次（随后自动恢复）"
                      className="h-8 px-2 rounded-[4px] border border-black/25 bg-white hover:bg-black/5 active:scale-[0.98] transition-transform no-select text-[12px] leading-5"
                      onClick={hideForNextRound}
                    >
                      下轮隐藏
                    </button>
                  </>
                )}
                <button
                  aria-label="收起播放器"
                  title="收起播放器"
                  className="h-8 w-8 rounded-[4px] border border-black/25 bg-white hover:bg-black/5 active:scale-[0.98] transition-transform no-select"
                  onClick={() => setCollapsed(true)}
                >
                  ▾
                </button>
              </div>
            </div>

            {/* 默认播放音乐开关（持久化，默认不勾选） */}
            <div className="mt-2">
              <label className="flex items-center gap-2 text-[13px] leading-5">
                <input
                  type="checkbox"
                  checked={autoPlayPref}
                  onChange={(e) => setAutoPlayPref(e.target.checked)}
                  className="h-4 w-4 rounded border border-black/30"
                  aria-label="默认播放音乐（若未生效请去浏览器设置里打开允许，）"
                  title="默认播放音乐（若未生效请去浏览器设置里打开允许）"
                />
                <span>默认播放音乐（若未生效请去浏览器设置里打开允许）</span>
              </label>
            </div>

            {/* 时间 + 控件一行 */}
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="text-[12px] leading-5 opacity-70">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
              <div className="flex items-center gap-2">
                <button
                  aria-label="上一首"
                  className="h-10 w-10 rounded-[4px] border border-black/25 bg-white hover:bg-black/5 active:scale-[0.98] transition-transform no-select"
                  onClick={() => handlePrev(false)}
                >
                  ◁
                </button>
                <button
                  aria-label={isPlaying ? "暂停" : "播放"}
                  className="h-10 w-10 rounded-[4px] border border-black/25 bg-white hover:bg-black/5 active:scale-[0.98] transition-transform no-select"
                  onClick={handlePlayPause}
                >
                  {isPlaying ? "⏸" : "⏵"}
                </button>
                <button
                  aria-label="下一首"
                  className="h-10 w-10 rounded-[4px] border border-black/25 bg-white hover:bg-black/5 active:scale-[0.98] transition-transform no-select"
                  onClick={() => handleNext(false)}
                >
                  ▷
                </button>
                <button
                  aria-label={showList ? "隐藏列表" : "显示列表"}
                  className="h-10 w-10 rounded-[4px] border border-black/25 bg-white hover:bg-black/5 active:scale-[0.98] transition-transform no-select"
                  onClick={() => setShowList((v) => !v)}
                  title={showList ? "隐藏列表" : "显示列表"}
                >
                  ☰
                </button>
                <button
                  aria-label={showVolume ? "隐藏音量控制" : "显示音量控制"}
                  className="h-10 w-10 rounded-[4px] border border-black/25 bg-white hover:bg-black/5 active:scale-[0.98] transition-transform no-select"
                  onClick={() => setShowVolume((v) => !v)}
                  title={showVolume ? "隐藏音量" : "显示音量"}
                >
                  🔊
                </button>
                <button
                  aria-label={`播放模式：${modeLabel}`}
                  className="h-10 w-10 rounded-[4px] border border-black/25 bg-white hover:bg-black/5 active:scale-[0.98] transition-transform no-select"
                  onClick={toggleMode}
                  title={`播放模式：${modeLabel}`}
                >
                  {modeIcon}
                </button>
              </div>
            </div>

            <div
              className="mt-3 h-2 w-full rounded-full bg-black/10 cursor-pointer"
              onMouseDown={onProgressMouseDown}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressFrac * 100)}
              aria-label="播放进度"
            >
              <div className="h-full rounded-full bg-black" style={{ width: barWidth }} />
            </div>

            {showVolume && (
              <div className="mt-3">
                <div
                  className="h-2 w-full rounded-full bg-black/10 cursor-pointer"
                  onMouseDown={onVolumeMouseDown}
                  role="slider"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(volume * 100)}
                  aria-label="音量"
                  title="音量"
                >
                  <div className="h-full rounded-full bg-black" style={{ width: volWidth }} />
                </div>
                <div className="mt-1 text-[12px] leading-5 opacity-70">音量：{Math.round(volume * 100)}%</div>
              </div>
            )}

            {showList && (
              <div className="mt-3 max-h-40 overflow-auto rounded-[4px] border border-black/20 bg-white">
                {tracks.length === 0 ? (
                  <div className="p-3 text-[14px] leading-6 opacity-70">未找到音乐文件</div>
                ) : (
                  <ul>
                    {tracks.map((t, i) => (
                      <li
                        key={t.file}
                        className={
                          "flex items-center justify-between px-3 py-2 border-b border-black/10 " +
                          (i === idx ? "bg-black/5 font-semibold" : "")
                        }
                      >
                        <button
                          className="text-left flex-1"
                          aria-label={`播放 ${t.name}`}
                          onClick={() => handleSelect(i)}
                        >
                          {t.name}
                        </button>
                        {i === idx && (
                          <span className="text-[12px] leading-5 opacity-70">正在播放</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* 音频元素始终保留，以便收起时继续播放 */}
      <audio ref={audioRef} preload="metadata" className="hidden" />
    </div>
  );
}