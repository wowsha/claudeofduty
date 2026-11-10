import type React from "react";
import { useEffect, useRef, useState } from "react";
import { IS_TOUCH, type Game, type GameMode, type HudState } from "../game/game";
import TouchControls from "./TouchControls";

const FONT = `"Bahnschrift","DIN Alternate","Roboto Condensed","Arial Narrow","Franklin Gothic Medium",Impact,sans-serif`;
const shadow = { textShadow: "0 1px 2px rgba(0,0,0,.9), 0 0 8px rgba(0,0,0,.55)" } as const;

interface Popup { id: number; text: string; sub?: string; color: string }
interface Dmg { id: number; angle: number }

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function Compass({ yaw }: { yaw: number }) {
  const heading = ((((-yaw * 180) / Math.PI) % 360) + 360) % 360;
  const ppd = 2.4;
  const ticks: React.ReactElement[] = [];
  for (let rep = -1; rep <= 1; rep++) {
    for (let d = 0; d < 360; d += 5) {
      const major = d % 45 === 0, mid = d % 15 === 0;
      const x = (d + rep * 360) * ppd;
      ticks.push(
        <div key={`${rep}-${d}`} className="absolute top-0" style={{ left: x, transform: "translateX(-50%)" }}>
          <div style={{ width: major ? 2 : 1, height: major ? 12 : mid ? 8 : 4, background: "rgba(255,255,255,.85)", margin: "0 auto", boxShadow: "0 0 3px #000" }} />
          {major && (
            <div style={{ ...shadow, fontFamily: FONT, fontSize: d % 90 === 0 ? 16 : 12, fontWeight: 700, letterSpacing: 1, marginTop: 1, textAlign: "center", color: d === 0 ? "#ff6a4d" : "#fff" }}>
              {DIRS[d / 45]}
            </div>
          )}
        </div>,
      );
    }
  }
  return (
    <div className="absolute left-1/2 top-4 -translate-x-1/2" style={{ width: 460 }}>
      <div className="relative h-9 overflow-hidden" style={{ maskImage: "linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent)", WebkitMaskImage: "linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent)" }}>
        <div className="absolute top-0" style={{ left: 230 - heading * ppd, width: 0 }}>{ticks}</div>
      </div>
      <div className="absolute left-1/2 -top-1 -translate-x-1/2 text-white" style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "7px solid #fff", filter: "drop-shadow(0 1px 1px #000)" }} />
      <div className="text-center text-white/90" style={{ ...shadow, fontFamily: FONT, fontSize: 12, fontWeight: 700, letterSpacing: 2, marginTop: -2 }}>{String(Math.round(heading)).padStart(3, "0")}</div>
    </div>
  );
}

function Crosshair({ s }: { s: HudState }) {
  const gap = Math.max(5, Math.min(70, s.spread));
  const vis = 1 - Math.min(1, s.ads * 1.6);
  const bar = (style: React.CSSProperties) => <div className="absolute bg-white" style={{ boxShadow: "0 0 0 1px rgba(0,0,0,.55)", ...style }} />;
  return (
    <div className="absolute left-1/2 top-1/2" style={{ opacity: vis * (s.sprint ? 0.45 : 0.95) }}>
      {bar({ width: 2, height: 9, left: -1, top: -gap - 9 })}
      {bar({ width: 2, height: 9, left: -1, top: gap })}
      {bar({ width: 9, height: 2, top: -1, left: -gap - 9 })}
      {bar({ width: 9, height: 2, top: -1, left: gap })}
      <div className="absolute rounded-full bg-white" style={{ width: 2, height: 2, left: -1, top: -1, opacity: 0.9, boxShadow: "0 0 0 1px rgba(0,0,0,.5)" }} />
    </div>
  );
}

function Minimap({ game, s }: { game: Game; s: HudState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { game.setMinimap(ref.current); return () => game.setMinimap(null); }, [game]);
  return (
    <div className="absolute left-5 top-5" style={{ width: 188, height: 188, ...(IS_TOUCH ? { transform: "scale(.75)", transformOrigin: "top left" } : {}) }}>
      <div className="absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 2px rgba(255,255,255,.55), 0 0 0 5px rgba(0,0,0,.35), 0 6px 18px rgba(0,0,0,.6)", background: "rgba(8,12,10,.5)" }} />
      <canvas ref={ref} width={376} height={376} className="absolute inset-0 h-full w-full rounded-full" />
      <div className="absolute left-1/2 -top-0.5 -translate-x-1/2 text-[11px] font-bold text-white/90" style={{ ...shadow, fontFamily: FONT }}>N</div>
      <div className="absolute -bottom-9 left-0 right-0 flex items-center gap-2">
        <div className="h-[6px] flex-1 overflow-hidden" style={{ background: "rgba(0,0,0,.55)", boxShadow: "0 0 0 1px rgba(255,255,255,.25)" }}>
          <div style={{ width: `${s.health}%`, height: "100%", background: s.health > 40 ? "linear-gradient(90deg,#d9e2dc,#fff)" : "linear-gradient(90deg,#b3281d,#ff5b45)", transition: "width .15s" }} />
        </div>
        <div className="text-xs font-bold text-white" style={{ ...shadow, fontFamily: FONT, width: 28, textAlign: "right" }}>{s.health}</div>
      </div>
    </div>
  );
}

function Ammo({ s }: { s: HudState }) {
  const low = s.ammo <= 8;
  const bars = [];
  for (let i = 0; i < s.mag; i++) {
    const on = i < s.ammo;
    bars.push(<div key={i} style={{ width: 4, height: 16, background: on ? (low ? "#ff5640" : "rgba(255,255,255,.92)") : "rgba(255,255,255,.14)", boxShadow: on ? "0 0 4px rgba(0,0,0,.8)" : "none", transform: "skewX(-12deg)" }} />);
  }
  return (
    <div className="absolute bottom-7 right-9 flex flex-col items-end" style={{ fontFamily: FONT, ...shadow, ...(IS_TOUCH ? { bottom: 240, right: 16, transform: "scale(.52)", transformOrigin: "bottom right" } : {}) }}>
      <div className="flex items-end gap-3 text-white">
        <div style={{ fontSize: 76, lineHeight: 0.85, fontWeight: 700, letterSpacing: -1, color: s.ammo === 0 ? "#ff4a33" : low ? "#ffb4a8" : "#fff", fontVariantNumeric: "tabular-nums" }}>{String(s.ammo).padStart(2, "0")}</div>
        <div style={{ fontSize: 30, fontWeight: 600, opacity: 0.8, paddingBottom: 2, fontVariantNumeric: "tabular-nums" }}>/ {s.reserve}</div>
      </div>
      <div className="mt-2 flex gap-[3px]">{bars}</div>
      <div className="mt-3 flex items-center gap-3 text-white/90" style={{ fontSize: 15, letterSpacing: 3, fontWeight: 700 }}>
        <span>XM-7 CARBINE</span>
        <span className="px-2 py-[1px] text-[11px]" style={{ border: "1px solid rgba(255,255,255,.65)", letterSpacing: 2 }}>AUTO</span>
      </div>
    </div>
  );
}

function Score({ s }: { s: HudState }) {
  return (
    <div className="absolute right-8 top-5 text-right text-white" style={{ fontFamily: FONT, ...shadow, ...(IS_TOUCH ? { transform: "scale(.68)", transformOrigin: "top right" } : {}) }}>
      <div style={{ fontSize: 13, letterSpacing: 4, opacity: 0.8, fontWeight: 700 }}>WAVE {s.wave}</div>
      <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.score.toLocaleString()}</div>
      <div className="mt-1 flex justify-end gap-4" style={{ fontSize: 13, letterSpacing: 2, opacity: 0.9, fontWeight: 600 }}>
        <span>KILLS <b className="text-white">{s.kills}</b></span>
        <span>HS <b className="text-white">{s.headshots}</b></span>
        <span>HOSTILES <b className="text-[#ff7a62]">{s.remaining}</b></span>
      </div>
      <div className="mt-1 text-[11px] opacity-50">{s.fps} FPS</div>
    </div>
  );
}

const MODES: [GameMode, string][] = [["tdm", "TEAM DEATHMATCH"], ["ffa", "FREE FOR ALL"], ["survival", "SURVIVAL"]];
const MODE_INFO: Record<GameMode, string> = {
  tdm: "Blue (you + 3 allies) vs Red (4 hostiles). First to 30 team eliminations, or the higher team after 6 minutes. Bots fight each other too, so you're never the only target.",
  ffa: "Everyone for themselves: you vs 7 bots. First to 20 eliminations, or the most after 6 minutes.",
  survival: "Waves of hostiles push into the plaza. Hold it as long as you can.",
};

/** Team scores + clock for team modes; kills + leader for free-for-all. */
function MatchBar({ s }: { s: HudState }) {
  const m = Math.max(0, Math.ceil(s.matchLeft));
  const clock = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 text-center text-white" style={{ top: 66, fontFamily: FONT, ...shadow }}>
      {s.mode === "tdm" ? (
        <div className="flex items-center justify-center gap-6" style={{ fontWeight: 800 }}>
          <div className="text-right" style={{ width: 130, color: "#8cc2ff" }}><div style={{ fontSize: 11, letterSpacing: 3 }}>BLUE</div><div style={{ fontSize: 30, lineHeight: 1 }}>{s.teamA}</div></div>
          <div style={{ letterSpacing: 3 }}><div style={{ fontSize: 15 }}>{clock}</div><div style={{ fontSize: 10, opacity: 0.7 }}>FIRST TO {s.limit}</div></div>
          <div className="text-left" style={{ width: 130, color: "#ff8a7a" }}><div style={{ fontSize: 11, letterSpacing: 3 }}>RED</div><div style={{ fontSize: 30, lineHeight: 1 }}>{s.teamB}</div></div>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-6" style={{ letterSpacing: 3, fontWeight: 700 }}>
          <div style={{ fontSize: 14 }}>ELIMS <b>{s.kills}</b> / {s.limit}</div>
          <div style={{ fontSize: 15 }}>{clock}</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>LEADER {s.leader} · {s.leaderKills}</div>
        </div>
      )}
    </div>
  );
}

export default function Hud({ game }: { game: Game }) {
  const [s, setS] = useState<HudState>({ ...game.hud });
  const [hm, setHm] = useState<{ id: number; kind: string } | null>(null);
  const [pops, setPops] = useState<Popup[]>([]);
  const [dmg, setDmg] = useState<Dmg[]>([]);
  const [dead, setDead] = useState<{ kills: number; score: number; wave: number; headshots: number } | null>(null);
  const idRef = useRef(1);
  const [feed, setFeed] = useState<{ id: number; text: string; team: number }[]>([]);

  useEffect(() => {
    const iv = setInterval(() => setS({ ...game.hud }), 50);
    const offs = [
      game.on("hit", (d: { kind: string }) => setHm({ id: idRef.current++, kind: d.kind })),
      game.on("kill", (d: { points: number; headshot: boolean; streak: number; dist: number }) => {
        const id = idRef.current++;
        setPops((p) => [...p.slice(-3), { id, text: `+${d.points}`, sub: `${d.headshot ? "HEADSHOT " : ""}ELIMINATED${d.streak > 2 ? ` · x${d.streak} STREAK` : ""} · ${d.dist}M`, color: d.headshot ? "#ffd24a" : "#fff" }]);
        setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 2200);
      }),
      game.on("damage", (d: { angle: number }) => {
        const id = idRef.current++;
        setDmg((p) => [...p.slice(-5), { id, angle: d.angle }]);
        setTimeout(() => setDmg((p) => p.filter((x) => x.id !== id)), 1300);
      }),
      game.on("dead", (d: { kills: number; score: number; wave: number; headshots: number }) => setDead(d)),
      game.on("feed", (d: { text: string; team: number }) => {
        const id = idRef.current++;
        setFeed((p) => [...p.slice(-4), { id, ...d }]);
        setTimeout(() => setFeed((p) => p.filter((x) => x.id !== id)), 4000);
      }),
    ];
    return () => { clearInterval(iv); offs.forEach((o) => o()); };
  }, [game]);

  useEffect(() => { if (s.status === "playing" && dead) setDead(null); }, [s.status, dead]);

  const playing = s.status === "playing" || s.status === "dead";
  const emptyPrompt = s.status === "playing" && s.ammo === 0 && s.reserve === 0;
  const reloadPrompt = s.status === "playing" && s.lowAmmo && s.reserve > 0 && !s.reloading;

  return (
    <div className="pointer-events-none absolute inset-0 select-none overflow-hidden" style={{ fontFamily: FONT }}>
      {playing && (
        <>
          <Compass yaw={s.yaw} />
          <Minimap game={game} s={s} />
          <Score s={s} />
          {s.mode !== "survival" && <MatchBar s={s} />}
          <div className="absolute right-8 top-[118px] flex flex-col items-end gap-1 text-right" style={{ fontFamily: FONT, ...shadow }}>
            {feed.map((f) => (
              <div key={f.id} style={{ fontSize: 12, letterSpacing: 1.5, fontWeight: 700, color: f.team === 0 ? "#8cc2ff" : "#ff8a7a", animation: "popup 4s ease-out forwards" }}>{f.text}</div>
            ))}
          </div>
          <Ammo s={s} />
          <Crosshair s={s} />

          {IS_TOUCH && s.status === "playing" && <TouchControls game={game} />}
          {IS_TOUCH && s.status === "playing" && (
            <div className="rotate-hint">
              <div className="rotate-hint-icon" />
              <div>ROTATE TO LANDSCAPE</div>
            </div>
          )}

          {/* damage direction */}
          {dmg.map((d) => (
            <div key={d.id} className="absolute left-1/2 top-1/2" style={{ width: 0, height: 0, transform: `rotate(${d.angle}rad)`, animation: "dmgfade 1.3s ease-out forwards" }}>
              <div style={{ position: "absolute", left: -90, top: -190, width: 180, height: 46, background: "radial-gradient(ellipse at 50% 0%, rgba(255,40,25,.95), rgba(255,40,25,.0) 70%)", filter: "blur(1px)", clipPath: "polygon(0 0,100% 0,85% 100%,15% 100%)" }} />
            </div>
          ))}

          {/* hit marker */}
          {hm && (
            <div key={hm.id} className="absolute left-1/2 top-1/2" style={{ animation: "hm .28s ease-out forwards" }}>
              {[0, 90, 180, 270].map((r) => (
                <div key={r} className="absolute" style={{ left: 0, top: 0, transform: `rotate(${r + 45}deg) translateY(-${hm.kind === "kill" ? 15 : 11}px)` }}>
                  <div style={{ width: 2.5, height: hm.kind === "kill" ? 14 : 9, marginLeft: -1.25, background: hm.kind === "kill" ? "#ff3b2b" : hm.kind === "head" ? "#ffd24a" : "#fff", boxShadow: "0 0 3px #000" }} />
                </div>
              ))}
            </div>
          )}

          {/* score popups */}
          <div className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ top: "62%" }}>
            {pops.map((p) => (
              <div key={p.id} className="text-center" style={{ ...shadow, animation: "popup 2.2s ease-out forwards", color: p.color }}>
                <span style={{ fontSize: 26, fontWeight: 700, marginRight: 10 }}>{p.text}</span>
                <span style={{ fontSize: 13, letterSpacing: 2.5, fontWeight: 700, opacity: 0.9 }}>{p.sub}</span>
              </div>
            ))}
          </div>

          {/* prompts */}
          <div className="absolute left-1/2 -translate-x-1/2 text-center" style={{ top: "70%", ...shadow }}>
            {reloadPrompt && <div style={{ fontSize: 16, letterSpacing: 4, fontWeight: 700, color: "#fff", animation: "blink 1s infinite" }}>[R] RELOAD</div>}
            {emptyPrompt && <div style={{ fontSize: 16, letterSpacing: 4, fontWeight: 700, color: "#ff5a45" }}>NO AMMO</div>}
            {s.reloading && (
              <div className="mx-auto mt-1" style={{ width: 120 }}>
                <div style={{ fontSize: 12, letterSpacing: 4, fontWeight: 700, color: "#fff", marginBottom: 4 }}>RELOADING</div>
                <div style={{ height: 3, background: "rgba(255,255,255,.2)" }}><div style={{ height: "100%", width: `${Math.min(100, s.reloadU * 100)}%`, background: "#fff" }} /></div>
              </div>
            )}
          </div>

          {/* wave banner */}
          {s.bannerT > 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 text-center text-white" style={{ top: "24%", opacity: Math.min(1, s.bannerT), ...shadow }}>
              <div style={{ fontSize: 14, letterSpacing: 10, fontWeight: 700, opacity: 0.8 }}>HOSTILES INBOUND</div>
              <div style={{ fontSize: 58, fontWeight: 800, letterSpacing: 8, lineHeight: 1.05 }}>{s.banner}</div>
              <div style={{ width: 240, height: 2, margin: "8px auto 0", background: "linear-gradient(90deg,transparent,#fff,transparent)" }} />
            </div>
          )}
        </>
      )}

      {s.status === "menu" && <Menu game={game} s={s} />}
      {s.status === "paused" && (
        <div className="pointer-events-auto absolute inset-0 flex cursor-pointer flex-col items-center justify-center text-white" style={{ background: "rgba(5,7,6,.62)", backdropFilter: "blur(3px)" }} onClick={() => game.deploy()}>
          <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: 14 }}>PAUSED</div>
          <div className="mt-3 opacity-80" style={{ letterSpacing: 6, fontSize: 15 }}>{IS_TOUCH ? "TAP" : "CLICK"} TO RESUME</div>
        </div>
      )}
      {s.status === "dead" && s.mode !== "survival" && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center text-white" style={{ background: "radial-gradient(ellipse at center, rgba(60,0,0,.35), rgba(10,0,0,.82))" }}>
          <div style={{ fontSize: 14, letterSpacing: 10, opacity: 0.8 }}>ELIMINATED BY</div>
          <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: 6, color: "#ff4a33" }}>{s.killedBy}</div>
          <div className="mt-6" style={{ fontSize: 15, letterSpacing: 6 }}>REDEPLOYING IN {s.respawnIn}</div>
        </div>
      )}
      {s.status === "over" && s.result && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col overflow-y-auto text-white" style={{ background: "radial-gradient(ellipse at center, rgba(8,10,12,.7), rgba(4,5,6,.96))" }}>
          <div className="my-auto flex flex-col items-center px-5 py-8 text-center">
            <div style={{ fontSize: 13, letterSpacing: 8, opacity: 0.75 }}>MATCH OVER · {s.mode === "tdm" ? "TEAM DEATHMATCH" : "FREE FOR ALL"}</div>
            <div style={{ fontSize: "clamp(56px,10vw,92px)", fontWeight: 900, letterSpacing: 8, lineHeight: 1, color: s.result.title === "VICTORY" ? "#fff" : "#ff4a33" }}>{s.result.title}</div>
            <div className="mt-2" style={{ fontSize: 14, letterSpacing: 3, opacity: 0.85 }}>{s.result.sub}</div>
            <div className="mt-5 grid w-[min(440px,88vw)] gap-y-1" style={{ fontSize: 13, letterSpacing: 2 }}>
              {s.result.rows.map((r, i) => (
                <div key={`${r.name}-${i}`} className="flex justify-between border-b border-white/10 py-1" style={{ fontWeight: r.you ? 800 : 500, color: s.mode === "tdm" ? (r.team === 0 ? "#8cc2ff" : "#ff8a7a") : "#fff" }}>
                  <span>{i + 1}. {r.name}</span><span>{r.kills}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex gap-4">
              <button className="cursor-pointer px-8 py-3 text-black" style={{ background: "#fff", fontWeight: 800, letterSpacing: 6 }} onClick={() => game.deploy()}>PLAY AGAIN</button>
              <button className="cursor-pointer px-6 py-3" style={{ border: "1px solid rgba(255,255,255,.6)", fontWeight: 700, letterSpacing: 4 }} onClick={() => game.toMenu()}>MENU</button>
            </div>
          </div>
        </div>
      )}
      {s.status === "dead" && s.mode === "survival" && dead && (
        <div className="pointer-events-auto absolute inset-0 flex cursor-pointer flex-col items-center justify-center text-white" style={{ background: "radial-gradient(ellipse at center, rgba(60,0,0,.35), rgba(10,0,0,.82))" }} onClick={() => game.deploy()}>
          <div style={{ fontSize: 14, letterSpacing: 10, opacity: 0.8 }}>MISSION FAILED</div>
          <div style={{ fontSize: 86, fontWeight: 800, letterSpacing: 10, color: "#ff4a33", textShadow: "0 0 30px rgba(255,40,20,.45)" }}>K.I.A.</div>
          <div className="mt-4 flex gap-10" style={{ letterSpacing: 3 }}>
            {[["WAVE", dead.wave], ["ELIMINATIONS", dead.kills], ["HEADSHOTS", dead.headshots], ["SCORE", dead.score.toLocaleString()]].map(([k, v]) => (
              <div key={String(k)} className="text-center"><div style={{ fontSize: 12, opacity: 0.65 }}>{k}</div><div style={{ fontSize: 34, fontWeight: 700 }}>{v}</div></div>
            ))}
          </div>
          <div className="mt-10" style={{ fontSize: 15, letterSpacing: 6, animation: "blink 1.2s infinite" }}>{IS_TOUCH ? "TAP" : "CLICK"} TO REDEPLOY</div>
        </div>
      )}
    </div>
  );
}

function Menu({ game, s }: { game: Game; s: HudState }) {
  const keys: [string, string][] = IS_TOUCH
    ? [["LEFT STICK", "Move"], ["DRAG RIGHT", "Look"], ["FIRE", "Hold to shoot"], ["AIM", "Toggle sights"], ["RELOAD / JUMP", "On-screen buttons"], ["SPRINT / CROUCH", "On-screen buttons"]]
    : [["W A S D", "Move"], ["SHIFT", "Sprint"], ["C / CTRL", "Crouch"], ["SPACE", "Jump"], ["MOUSE 1", "Fire"], ["MOUSE 2", "Aim down sights"], ["R", "Reload"]];
  return (
    <div className="pointer-events-auto absolute inset-0 flex flex-col overflow-y-auto text-white" style={{ background: "linear-gradient(90deg, rgba(4,6,5,.92) 0%, rgba(4,6,5,.7) 45%, rgba(4,6,5,.05) 100%)" }}>
      <div className="my-auto ml-[7vw] max-w-[560px] px-5 py-8">
        <div style={{ fontSize: 13, letterSpacing: 12, opacity: 0.7, fontWeight: 700 }}>OPERATION</div>
        <div style={{ fontSize: "clamp(54px,8vw,104px)", fontWeight: 900, letterSpacing: 6, lineHeight: 0.95, textShadow: "0 4px 30px rgba(0,0,0,.6)" }}>DEAD<br />DROP</div>
        <div className="mt-3" style={{ width: 90, height: 4, background: "#ff5a3d" }} />
        <div className="mt-5 opacity-80" style={{ fontSize: 15, letterSpacing: 2, lineHeight: 1.6, maxWidth: 440 }}>
          Hold the plaza. Waves of hostiles are moving in through the alleys. Use cover, watch your flanks, headshots end fights faster.
        </div>
        <button className="mt-8 cursor-pointer px-10 py-4 text-black transition hover:brightness-110" style={{ background: "#fff", fontWeight: 800, letterSpacing: 8, fontSize: 18, clipPath: "polygon(0 0,100% 0,100% 70%,94% 100%,0 100%)" }} onClick={() => game.deploy()}>
          DEPLOY
        </button>
        <div className="mt-6 flex flex-wrap items-center gap-2" style={{ fontSize: 12, letterSpacing: 3, opacity: 0.9 }}>
          <span className="w-[70px] opacity-70">MODE</span>
          {MODES.map(([id, label]) => (
            <button key={id} className="cursor-pointer px-3 py-1" style={{ border: "1px solid rgba(255,255,255,.55)", background: s.mode === id ? "#fff" : "transparent", color: s.mode === id ? "#000" : "#fff", fontWeight: 700 }} onClick={() => game.setMode(id)}>{label}</button>
          ))}
        </div>
        <div className="mt-2 opacity-70" style={{ fontSize: 12, letterSpacing: 1.5, lineHeight: 1.5, maxWidth: 440 }}>{MODE_INFO[s.mode]}</div>
        <div className="mt-8 flex flex-wrap items-center gap-3" style={{ fontSize: 12, letterSpacing: 4, opacity: 0.85 }}>
          <span className="opacity-70">GRAPHICS</span>
          {["LOW", "MEDIUM", "HIGH"].map((n, i) => (
            <button key={n} className="cursor-pointer px-3 py-1" style={{ border: "1px solid rgba(255,255,255,.55)", background: s.quality === i ? "#fff" : "transparent", color: s.quality === i ? "#000" : "#fff", fontWeight: 700 }} onClick={() => game.setQuality(i)}>{n}</button>
          ))}
        </div>
        <div className="mt-8 grid grid-cols-1 gap-y-1 sm:grid-cols-2 sm:gap-x-8" style={{ fontSize: 12, letterSpacing: 2, maxWidth: 440 }}>
          {keys.map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-white/10 py-1"><b>{k}</b><span className="opacity-70">{v}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
