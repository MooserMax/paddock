"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { RaceTelemetryData } from "@/lib/api/types";
import { ordinal } from "@/lib/format";

// RACE TELEMETRY: a restrained, side-scroll race visualization rendered from real
// per-tick data. Camera from the side; one lane per runner; x = real meters / track
// length, so further right = further ahead. The user's runner is the only warm element
// in a cool field. Motion is the data made visible: position is real, the light-trail
// length and the figure's bloom track real speed. Nothing here is decorative.
//
// PROPORTION (the hard rule): a runner's height is 0.40 of the lane spacing (hero 0.42),
// both under the 0.45 ceiling, so there is always far more empty space around a runner
// than the runner occupies, and adjacent lanes can never overlap.

const HERO_GLOW = "#e8694f";
const HERO_CORE = "#ffd9cc";
const FIELD_COOL = ["#56c2d6", "#6f9bd0", "#5fb0a0", "#8f86c8", "#5aa0c0", "#69bca8", "#8a9bb0", "#6aa6c4"];
const GOLD = "#e6bc5c";
const CYAN = "#6fd6ec";
const BG = "#0b0a09";

const FIELD_RATIO = 0.4; // runner height / lane spacing (field)
const HERO_RATIO = 0.42; // hero, still under the 0.45 ceiling
const STRIDE_M = 16; // meters per full stride cycle, sets leg cadence
const PLAY_MS = 11000; // brisk replay duration (8 to 14s); real time would be 55 to 160s

// Eased playback velocity over the run: a measured ramp off the gate and a slow-motion
// settle at the line, faster through the mid-race action, so it never feels mechanical.
// The order of overtakes is preserved because progress stays monotonic in tick time.
const VEL_MEAN = 0.55 + 0.9 * (2 / Math.PI);
const vel = (p: number) => (0.55 + 0.9 * Math.sin(Math.PI * Math.max(0, Math.min(1, p)))) / VEL_MEAN;

type Layout = {
  w: number; h: number;
  trackLeft: number; trackRight: number; trackTop: number; trackBottom: number;
  panelW: number; padX: number; laneSpacing: number; figureH: number;
};

function computeLayout(w: number, h: number, n: number): Layout {
  const padX = Math.round(Math.min(40, Math.max(20, w * 0.028)));
  const titleBandH = 92;
  const controlsH = 58;
  const panelW = Math.round(Math.min(248, Math.max(178, w * 0.2)));
  const trackLeft = padX + panelW + 22;
  const trackRight = w - padX - 16;
  const trackTop = 26 + titleBandH;
  const trackBottom = h - controlsH - 18;
  const laneSpacing = (trackBottom - trackTop) / n;
  return { w, h, trackLeft, trackRight, trackTop, trackBottom, panelW, padX, laneSpacing, figureH: laneSpacing * FIELD_RATIO };
}

// A luminous profile sprinter facing +x, anchored at the hip. Articulated knees and
// elbows give a real running gait, not a stiff lunge. Returns the Path2D of all bones
// plus the head, so the caller can stroke it several times for a layered bloom.
function runnerPath(hipX: number, hipY: number, h: number, g: number): { bones: Path2D; headX: number; headY: number; headR: number } {
  const sinc = (len: number, ang: number): [number, number] => [Math.sin(ang) * len, Math.cos(ang) * len]; // ang from straight-down, + = forward(+x), y down
  const up = (len: number, ang: number): [number, number] => [Math.sin(ang) * len, -Math.cos(ang) * len]; // ang from straight-up

  const torso = 0.34 * h, neck = 0.05 * h, headR = 0.075 * h;
  const thigh = 0.2 * h, shin = 0.23 * h;
  const upper = 0.16 * h, fore = 0.15 * h;

  const lean = 0.2; // whole-body forward lean
  const [sx, sy] = up(torso, lean); const shX = hipX + sx, shY = hipY + sy; // shoulder
  const [nx, ny] = up(neck, lean); const hbX = shX + nx, hbY = shY + ny; // neck top
  const [hx, hy] = up(headR * 0.9, lean); const headX = hbX + hx, headY = hbY + hy;

  const leg = (phase: number): [number, number, number, number] => {
    const thighAng = 0.1 + 0.7 * Math.sin(phase);
    const kneeBend = 0.28 + 0.62 * (0.5 + 0.5 * Math.sin(phase + 1.7));
    const shinAng = thighAng - kneeBend;
    const [kx, ky] = sinc(thigh, thighAng); const knX = hipX + kx, knY = hipY + ky;
    const [fx, fy] = sinc(shin, shinAng); return [knX, knY, knX + fx, knY + fy];
  };
  const arm = (phase: number): [number, number, number, number] => {
    const upAng = 0.16 - 0.5 * Math.sin(phase);
    const elBend = 0.5 + 0.45 * (0.5 + 0.5 * Math.sin(phase + 0.6));
    const foreAng = upAng + elBend;
    const [ex, ey] = sinc(upper, upAng); const elX = shX + ex, elY = shY + ey;
    const [hx2, hy2] = sinc(fore, foreAng); return [elX, elY, elX + hx2, elY + hy2];
  };

  const p = new Path2D();
  // torso
  p.moveTo(hipX, hipY); p.lineTo(shX, shY); p.lineTo(hbX, hbY);
  // legs (near, far 180 out of phase)
  const [k1x, k1y, f1x, f1y] = leg(g);
  const [k2x, k2y, f2x, f2y] = leg(g + Math.PI);
  p.moveTo(hipX, hipY); p.lineTo(k1x, k1y); p.lineTo(f1x, f1y);
  p.moveTo(hipX, hipY); p.lineTo(k2x, k2y); p.lineTo(f2x, f2y);
  // arms
  const [e1x, e1y, h1x, h1y] = arm(g + Math.PI);
  const [e2x, e2y, h2x, h2y] = arm(g);
  p.moveTo(shX, shY); p.lineTo(e1x, e1y); p.lineTo(h1x, h1y);
  p.moveTo(shX, shY); p.lineTo(e2x, e2y); p.lineTo(h2x, h2y);
  return { bones: p, headX, headY, headR };
}

function ProgressTime({ ms }: { ms: number }) {
  const s = ms / 1000;
  return <span>{s.toFixed(1)}s</span>;
}

export default function RaceTelemetry({ data, heroPetId, heroLabel, modelRank, raceTitle }: {
  data: RaceTelemetryData;
  heroPetId: number;
  heroLabel: string;
  modelRank: number | null;
  raceTitle: string;
}) {
  const N = data.numPets;
  const heroIndex = useMemo(() => data.pets.findIndex((p) => p.id === heroPetId), [data.pets, heroPetId]);
  const heroFinalRank = heroIndex >= 0 ? data.pets[heroIndex].finalRank : 1;

  // Stable per-pet visual assignments: lane by final rank (winner on top), cool color
  // for the field, the one warm hero.
  const view = useMemo(() => {
    const laneOf = new Array(N).fill(0);
    const color = new Array<string>(N).fill(FIELD_COOL[0]);
    let coolI = 0;
    // assign lanes by final rank
    data.pets.forEach((p, i) => { laneOf[i] = Math.min(N - 1, Math.max(0, p.finalRank - 1)); });
    data.pets.forEach((p, i) => { color[i] = i === heroIndex ? HERO_GLOW : FIELD_COOL[coolI++ % FIELD_COOL.length]; });
    // velocity norm per frame per pet, for trail length
    const frames = data.frames;
    const vmax = new Array(N).fill(1e-6);
    const vel2: number[][] = frames.map((f, fi) => f.pos.map((m, i) => {
      const v = fi === 0 ? 0 : Math.max(0, m - frames[fi - 1].pos[i]);
      if (v > vmax[i]) vmax[i] = v;
      return v;
    }));
    const velNorm = vel2.map((row) => row.map((v, i) => v / vmax[i]));
    // decisive moment: first frame the hero holds its final rank (used only for the flare)
    let decisive = 0;
    if (heroIndex >= 0) { for (let f = 0; f < frames.length; f++) { if (frames[f].rank[heroIndex] === heroFinalRank) { decisive = f; break; } } }
    // balanced static still: the most strung-out frame in the middle of the race, so a
    // reduced-motion or share frame shows runners SPREAD, never piled at the line.
    let bestSpread = -1, bestF = Math.floor(frames.length * 0.45);
    const lo = Math.floor(frames.length * 0.3), hi = Math.floor(frames.length * 0.72);
    for (let f = lo; f <= hi && f < frames.length; f++) {
      const ps = frames[f].pos; const spread = Math.max(...ps) - Math.min(...ps);
      if (spread > bestSpread) { bestSpread = spread; bestF = f; }
    }
    return {
      laneOf, color, velNorm,
      decisiveProgress: frames.length > 1 ? decisive / (frames.length - 1) : 0,
      staticProgress: frames.length > 1 ? bestF / (frames.length - 1) : 0.45,
    };
  }, [data, N, heroIndex, heroFinalRank]);

  const startRank = data.frames[0]?.rank[heroIndex] ?? heroFinalRank;
  // Finishing order for the result payoff, from real finalRanking (pet ids in order).
  const finishOrder = useMemo(() => data.finalRanking.map((id, i) => ({ place: i + 1, id })), [data.finalRanking]);
  const winnerId = data.finalRanking[0] ?? null;
  // pet id -> its runner color, so the result list color-matches the figures on the track.
  const colorById = useMemo(() => {
    const m = new Map<number, string>();
    data.pets.forEach((p, i) => m.set(p.id, view.color[i]));
    return m;
  }, [data.pets, view.color]);

  const delta = modelRank != null ? modelRank - heroFinalRank : null;
  const verdict = useMemo(() => {
    if (delta == null) return `finished ${ordinal(heroFinalRank)} of ${N}`;
    if (delta > 0) return `defying the odds by +${delta} place${delta === 1 ? "" : "s"}`;
    if (delta === 0) return "exactly as the model called it";
    return `${Math.abs(delta)} place${Math.abs(delta) === 1 ? "" : "s"} below the model`;
  }, [delta, heroFinalRank, N]);

  // ---- canvas + animation -------------------------------------------------------
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const progressRef = useRef(0); // start at the gate; autoplay sweeps it across
  const rafRef = useRef<number | null>(null);

  const prevTsRef = useRef<number | null>(null);
  const hudThrottle = useRef(0);
  const [reduced, setReduced] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hud, setHud] = useState({ liveRank: startRank, progress: 0, tMs: 0, status: "breaking from the gate" });

  const sampleAt = useCallback((p: number) => {
    const frames = data.frames; const last = frames.length - 1;
    const fp = Math.max(0, Math.min(last, p * last));
    const i0 = Math.floor(fp), i1 = Math.min(last, i0 + 1), t = fp - i0;
    return { i0, i1, t, fp };
  }, [data.frames]);

  const draw = useCallback((forceHud = false) => {
    const canvas = canvasRef.current; const L = layoutRef.current; if (!canvas || !L) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const frames = data.frames; const p = progressRef.current;
    const { i0, i1, t, fp } = sampleAt(p);
    const lerp = (a: number, b: number) => a + (b - a) * t;
    const xOf = (m: number) => L.trackLeft + Math.min(m / data.trackLength, 1.02) * (L.trackRight - L.trackLeft);
    const laneY = (lane: number) => L.trackTop + (lane + 0.5) * L.laneSpacing;

    ctx.clearRect(0, 0, L.w, L.h);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, L.w, L.h);

    // --- track (quiet Tron floor) ---
    ctx.save();
    ctx.lineWidth = 1;
    // vertical distance gridlines
    ctx.strokeStyle = "rgba(111,214,236,0.045)";
    const gridN = 12;
    for (let k = 0; k <= gridN; k++) {
      const gx = L.trackLeft + (k / gridN) * (L.trackRight - L.trackLeft);
      ctx.beginPath(); ctx.moveTo(gx, L.trackTop); ctx.lineTo(gx, L.trackBottom); ctx.stroke();
    }
    // horizontal lane separators
    ctx.strokeStyle = "rgba(111,214,236,0.09)";
    for (let lane = 0; lane <= N; lane++) {
      const ly = L.trackTop + lane * L.laneSpacing;
      ctx.beginPath(); ctx.moveTo(L.trackLeft, ly); ctx.lineTo(L.trackRight, ly); ctx.stroke();
    }
    // start gate
    ctx.strokeStyle = "rgba(111,214,236,0.16)";
    ctx.beginPath(); ctx.moveTo(L.trackLeft, L.trackTop); ctx.lineTo(L.trackLeft, L.trackBottom); ctx.stroke();
    ctx.restore();

    // --- finish line (gold, restrained bloom) ---
    ctx.save();
    const fx = L.trackRight;
    ctx.shadowColor = GOLD; ctx.shadowBlur = 16;
    ctx.strokeStyle = "rgba(230,188,92,0.85)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx, L.trackTop); ctx.lineTo(fx, L.trackBottom); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = "rgba(230,188,92,0.9)";
    for (let lane = 0; lane < N; lane++) { const ly = laneY(lane); ctx.fillRect(fx - 3, ly - 1, 6, 2); }
    ctx.restore();

    // --- runners (field first, hero last on top) ---
    const ended = p >= 0.999; // at the finish: show finishing-order badges
    const order = data.pets.map((_, i) => i).sort((a, b) => (a === heroIndex ? 1 : 0) - (b === heroIndex ? 1 : 0));
    for (const i of order) {
      const isHero = i === heroIndex;
      const petId = data.pets[i].id; const finalRank = data.pets[i].finalRank;
      const meters = lerp(frames[i0].pos[i], frames[i1].pos[i]);
      const x = xOf(meters); const y = laneY(view.laneOf[i]);
      const h = L.figureH * (isHero ? HERO_RATIO / FIELD_RATIO : 1);
      const vN = lerp(view.velNorm[i0][i], view.velNorm[i1][i]);
      const surge = lerp(frames[i0].spd[i], frames[i1].spd[i]);
      const color = view.color[i];
      const core = isHero ? HERO_CORE : color;

      // trail: a tapered light streak behind the runner at body height
      const trailLen = h * (1.1 + 5.4 * vN) * (isHero ? 1.25 : 1) * (0.85 + 0.4 * Math.max(0, surge - 1));
      const nearW = h * (isHero ? 0.18 : 0.14);
      const tg = ctx.createLinearGradient(x, y, x - trailLen, y);
      tg.addColorStop(0, color); tg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = isHero ? 0.5 : 0.3;
      ctx.shadowColor = color; ctx.shadowBlur = h * 0.5;
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.moveTo(x, y - nearW); ctx.lineTo(x, y + nearW);
      ctx.lineTo(x - trailLen, y + nearW * 0.12); ctx.lineTo(x - trailLen, y - nearW * 0.12); ctx.closePath(); ctx.fill();
      if (isHero) { // hot core streak
        const cg = ctx.createLinearGradient(x, y, x - trailLen * 0.7, y);
        cg.addColorStop(0, HERO_CORE); cg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 0.85; ctx.fillStyle = cg;
        ctx.beginPath(); ctx.moveTo(x, y - nearW * 0.42); ctx.lineTo(x, y + nearW * 0.42);
        ctx.lineTo(x - trailLen * 0.7, y); ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      // figure: hip near lane center, vertically centered so it sits in clean space
      const g = meters * (Math.PI * 2 / STRIDE_M);
      const hipY = y + h * 0.12;
      const { bones, headX, headY, headR } = runnerPath(x, hipY, h, g);
      const coreW = Math.max(1.1, h * (isHero ? 0.055 : 0.05));
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "lighter";
      const passes = isHero
        ? [[h * 0.7, isHero ? 0.5 : 0.3, coreW * 2.3], [h * 0.28, 0.7, coreW * 1.4], [h * 0.08, 1, coreW]]
        : [[h * 0.5, 0.26, coreW * 2.0], [h * 0.1, 0.85, coreW]];
      for (let pi = 0; pi < passes.length; pi++) {
        const [blur, alpha, lw] = passes[pi];
        const last = pi === passes.length - 1;
        ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.globalAlpha = alpha as number;
        ctx.strokeStyle = last ? core : color; ctx.lineWidth = lw as number;
        ctx.stroke(bones);
        ctx.beginPath(); ctx.arc(headX, headY, headR, 0, Math.PI * 2); ctx.fillStyle = last ? core : color; ctx.fill();
      }
      ctx.restore();

      // #id label tucked into the clear space above each figure (Fix 3). Identifies every
      // runner; the spotlight is brick and emphasized. NO line crosses the lanes (Fix 2).
      const labelFs = Math.max(9, h * 0.32);
      ctx.save();
      ctx.font = `${isHero ? 700 : 500} ${labelFs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 3;
      ctx.fillStyle = isHero ? HERO_GLOW : color; ctx.globalAlpha = isHero ? 1 : 0.6;
      ctx.fillText(isHero ? `#${petId} YOU` : `#${petId}`, x, headY - headR - labelFs * 0.45);
      ctx.restore();

      // finishing-order badge on the podium and the spotlight, only at the finish (Fix 4):
      // a small numbered disc left of the figure, the winner gold with a crown.
      if (ended && (finalRank <= 3 || isHero)) {
        const bx = x - h * 0.9, by = headY + h * 0.05, br = Math.max(7, h * 0.36);
        const isWin = finalRank === 1;
        const bcol = isWin ? GOLD : isHero ? HERO_GLOW : finalRank === 2 ? "#c9d2dc" : "#cf9b6a";
        ctx.save();
        ctx.shadowColor = bcol; ctx.shadowBlur = 6;
        ctx.fillStyle = "rgba(11,10,9,0.92)"; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.lineWidth = 1.4; ctx.strokeStyle = bcol; ctx.stroke();
        ctx.fillStyle = bcol; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `700 ${br * 1.05}px ui-monospace, monospace`;
        ctx.fillText(String(finalRank), bx, by + 0.5);
        ctx.restore();
        if (isWin) { ctx.save(); ctx.fillStyle = GOLD; ctx.textAlign = "center"; ctx.font = `${br * 1.4}px serif`; ctx.fillText("♔", bx, by - br - 1); ctx.restore(); }
      }

      if (isHero) {
        // a tasteful flare at the decisive tick (an earned moment, not decoration). The
        // spotlight is identified by its warm color, label, and the left panel, not a line.
        const flare = Math.exp(-Math.pow((p - view.decisiveProgress) / 0.05, 2));
        if (flare > 0.02) {
          const rad = h * (1.4 + 2.6 * flare);
          const fg = ctx.createRadialGradient(x, y, 0, x, y, rad);
          fg.addColorStop(0, `rgba(255,217,204,${0.32 * flare})`); fg.addColorStop(1, "rgba(232,105,79,0)");
          ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = fg;
          ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      }
    }

    // DOM HUD: live rank, time, and a FRAME-ACCURATE status from the hero's recent rank
    // trend, throttled to ~10/s in the play loop, forced on a discrete redraw.
    const fi = Math.round(fp);
    const liveRank = frames[fi]?.rank[heroIndex] ?? heroFinalRank;
    const back = Math.max(0, fi - Math.max(2, Math.round(frames.length * 0.06)));
    const backRank = frames[back]?.rank[heroIndex] ?? liveRank;
    let status: string;
    if (p < 0.04) status = "breaking from the gate";
    else if (liveRank === 1) status = "in front";
    else if (liveRank - backRank <= -1) status = "moving up";
    else if (liveRank - backRank >= 1) status = "fading";
    else status = "holding its line";
    const tMs = lerp(frames[i0].tMs, frames[i1].tMs);
    const now = performance.now();
    if (forceHud || now - hudThrottle.current > 95) { hudThrottle.current = now; setHud({ liveRank, progress: p, tMs, status }); }
  }, [data, sampleAt, view, heroIndex, heroFinalRank, hudThrottle]);

  // size + dpr + initial paint, then AUTOPLAY from the gate (reduced-motion gets a
  // balanced mid-race still plus the result instead of motion). Runs once on mount.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const isReduced = mq.matches;
    setReduced(isReduced);
    const onMq = () => setReduced(mq.matches); mq.addEventListener("change", onMq);

    const wrap = wrapRef.current; const canvas = canvasRef.current; if (!wrap || !canvas) return;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`;
      const ctx = canvas.getContext("2d"); if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layoutRef.current = computeLayout(r.width, r.height, N);
      draw(true);
    };
    // DETERMINISTIC reset on every mount: force progress to the gate (or a balanced spread
    // still for reduced motion), reset the HUD so the result is hidden, then autoplay.
    // The decisive-frame value is never the initial progress; nothing can leave it parked.
    progressRef.current = isReduced ? view.staticProgress : 0;
    prevTsRef.current = null;
    setHud({ liveRank: startRank, progress: progressRef.current, tMs: 0, status: "breaking from the gate" });
    setPlaying(false);
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    if (!isReduced) setPlaying(true); // play itself on load, no user action
    return () => { ro.disconnect(); mq.removeEventListener("change", onMq); };
  // re-arm on a race change too, so a reused instance never keeps the prior race state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.raceId]);

  // Animation loop: active ONLY while playing, so a static/paused frame costs nothing.
  // Progress advances with an eased velocity so the gun-break and the line breathe.
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; draw(true); return; }
    prevTsRef.current = null;
    const step = (ts: number) => {
      const prev = prevTsRef.current ?? ts; const dt = Math.min(64, ts - prev); prevTsRef.current = ts;
      progressRef.current = Math.min(1, progressRef.current + (dt / PLAY_MS) * vel(progressRef.current));
      draw();
      if (progressRef.current >= 1) { progressRef.current = 1; draw(true); setPlaying(false); return; }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [playing, draw]);

  const onPlay = () => {
    if (progressRef.current >= 0.999) progressRef.current = 0; // replay from the gate
    setPlaying(true);
  };
  const onPause = () => setPlaying(false);
  const onReplay = () => { progressRef.current = 0; setPlaying(true); };
  const onScrub = (v: number) => { progressRef.current = v; setPlaying(false); draw(true); };

  const atEnd = hud.progress >= 0.999;
  // The result resolves only at the finish; reduced-motion users see it immediately
  // (static still + result). Mid-race shows the live running placing, never the result.
  const showResult = atEnd || reduced;

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-xl" style={{ background: BG, height: "min(900px, 78vh)", minHeight: 540 }}>
      <canvas ref={canvasRef} className="absolute inset-0" aria-hidden />

      {/* top-left HUD */}
      <div className="pointer-events-none absolute left-7 top-6">
        <p className="type-micro uppercase tracking-[0.25em]" style={{ color: CYAN }}>Race Telemetry</p>
        <h1 className="mt-1 font-serif text-3xl leading-none text-ink md:text-4xl">{raceTitle}</h1>
        <p className="type-micro mt-2 normal-case tracking-wider text-ink-faint">
          {data.trackLength}M&nbsp;&nbsp;·&nbsp;&nbsp;{N} RUNNERS&nbsp;&nbsp;·&nbsp;&nbsp;{data.finished ? "FINISHED" : "LIVE"}
        </p>
      </div>

      {/* top-right Paddock mark */}
      <div className="pointer-events-none absolute right-7 top-6 text-right">
        <p className="text-sm tracking-[0.2em] text-ink"><span style={{ color: "var(--green)" }}>✳</span>&nbsp;PADDOCK</p>
        <p className="type-micro mt-1 tracking-[0.18em] text-ink-faint">The Open Intelligence Layer</p>
      </div>

      {/* hero telemetry panel: frame-accurate. RUNNING + a live status until the finish,
          then RESULT + the verdict. MODEL EXPECTED shows throughout. */}
      {heroIndex >= 0 && (
        <div className="pointer-events-none absolute left-7" style={{ top: "50%", transform: "translateY(-50%)", width: "min(248px, 20vw)" }}>
          <p className="type-micro uppercase tracking-[0.2em]" style={{ color: CYAN }}>{heroLabel}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: HERO_GLOW }}>#{heroPetId}</p>
          <p className="type-micro mt-0.5 normal-case text-ink-soft">{showResult ? "result is in" : hud.status}</p>

          <div className="mt-4 space-y-1.5">
            {modelRank != null && (
              <div className="flex items-baseline gap-2">
                <span className="type-micro uppercase tracking-wider text-ink-faint">Model expected</span>
                <span className="type-data tabular-nums" style={{ color: CYAN }}>{ordinal(modelRank)}</span>
              </div>
            )}
            <div className="flex items-baseline gap-2">
              <span className="type-micro uppercase tracking-wider text-ink-faint">{showResult ? "Result" : "Running"}</span>
              <span className="text-lg font-semibold tabular-nums" style={{ color: showResult ? GOLD : HERO_CORE }}>{ordinal(showResult ? heroFinalRank : hud.liveRank)}</span>
            </div>
            {showResult && <p className="type-micro normal-case text-ink-soft">{verdict}</p>}
          </div>
        </div>
      )}

      {/* RESULT payoff: fades in at the finish (and for reduced motion). WON BY + the real
          finishing order, the spotlight runner in brick, plus a Replay. */}
      <div
        className="absolute right-7 transition-opacity duration-500"
        style={{ top: "46%", transform: "translateY(-50%)", width: "min(230px, 22vw)", opacity: showResult ? 1 : 0, pointerEvents: showResult ? "auto" : "none" }}
        aria-hidden={!showResult}
      >
        <p className="type-micro uppercase tracking-[0.2em] text-right" style={{ color: GOLD }}>Result</p>
        {winnerId != null && (
          <p className="mt-1 text-right font-serif text-2xl leading-none" style={{ color: winnerId === heroPetId ? HERO_GLOW : GOLD }}>
            Won by #{winnerId}
          </p>
        )}
        <ol className="mt-3 space-y-1">
          {finishOrder.map((f) => (
            <li key={f.id} className="flex items-baseline justify-end gap-2 tabular-nums">
              {f.place === 1 && <span aria-hidden style={{ color: GOLD }}>♔</span>}
              <span className="type-micro uppercase tracking-wider text-ink-faint">{ordinal(f.place)}</span>
              <span className="type-data" style={{ color: f.id === heroPetId ? HERO_GLOW : f.place === 1 ? GOLD : colorById.get(f.id) ?? "var(--ink-soft)" }}>#{f.id}</span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={onReplay}
          className="transition-paddock mt-4 ml-auto block rounded-md border px-3 py-1.5 text-ink-soft hover:border-glow hover:text-glow"
          style={{ borderColor: "var(--line-strong)" }}
        >
          <span className="type-micro uppercase tracking-wider">Replay ↺</span>
        </button>
      </div>

      {/* controls: play/pause + scrubber, always visible (the replay plays itself by default) */}
      <div className="absolute inset-x-7 bottom-4 flex items-center gap-3">
        <button
          type="button"
          onClick={atEnd ? onReplay : (playing ? onPause : onPlay)}
          aria-label={atEnd ? "Replay" : (playing ? "Pause replay" : "Play replay")}
          className="transition-paddock inline-flex h-8 w-8 items-center justify-center rounded-full border text-ink-soft hover:text-ink hover:border-line-strong"
          style={{ borderColor: "var(--line-strong)" }}
        >
          {atEnd ? "↺" : (playing ? "❙❙" : "▶")}
        </button>
        <input
          type="range" min={0} max={1000} value={Math.round(hud.progress * 1000)}
          onChange={(e) => onScrub(Number(e.target.value) / 1000)}
          aria-label="Scrub race timeline"
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full"
          style={{ accentColor: HERO_GLOW, background: "rgba(111,214,236,0.18)" }}
        />
        <span className="type-micro tabular-nums text-ink-faint"><ProgressTime ms={hud.tMs} /></span>
      </div>
    </div>
  );
}
