import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { Game } from "../game/game";

const FONT = `"Bahnschrift","DIN Alternate","Roboto Condensed","Arial Narrow","Franklin Gothic Medium",Impact,sans-serif`;

const STICK_R = 64; // max knob travel in px
const DEAD = 0.12; // dead zone, fraction of the stick radius
const SPLIT = 0.5; // left half of the screen = move stick, right half = look

/** Dead-zone + rescale so small thumb jitter doesn't drift the character. */
const curve = (v: number) => {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * Math.min(1, (a - DEAD) / (1 - DEAD));
};

interface Stick { ox: number; oy: number; kx: number; ky: number }

interface BtnProps {
  label: string;
  style: React.CSSProperties;
  size?: number;
  on?: boolean;
  primary?: boolean;
  onPress: (down: boolean) => void;
}

function Btn({ label, style, size = 62, on = false, primary = false, onPress }: BtnProps) {
  return (
    <button
      type="button"
      className="absolute flex select-none items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        touchAction: "none",
        fontFamily: FONT,
        letterSpacing: 2,
        fontSize: size >= 90 ? 18 : 11,
        color: on ? "#000" : "#fff",
        background: on ? "#fff" : "rgba(10,12,11,.42)",
        border: `2px solid rgba(255,255,255,${primary ? 0.9 : 0.55})`,
        boxShadow: "0 2px 8px rgba(0,0,0,.5)",
        ...style,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress(true);
      }}
      onPointerUp={(e) => { e.stopPropagation(); onPress(false); }}
      onPointerCancel={(e) => { e.stopPropagation(); onPress(false); }}
    >
      {label}
    </button>
  );
}

/**
 * On-screen controls for phones and tablets.
 * Left half: floating move stick. Right half: drag to look. Buttons sit on top of the touch layer.
 */
export default function TouchControls({ game }: { game: Game }) {
  const [stick, setStick] = useState<Stick | null>(null);
  const [fire, setFire] = useState(false);
  const [ads, setAds] = useState(false);
  const [sprint, setSprint] = useState(false);
  const [crouch, setCrouch] = useState(false);

  const moveId = useRef<number | null>(null);
  const moveOrigin = useRef({ x: 0, y: 0 });
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });

  // Release everything when the controls unmount (pause, death, menu).
  useEffect(() => () => game.resetTouch(), [game]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const { clientX: x, clientY: y, pointerId: id } = e;
    const left = x < window.innerWidth * SPLIT;
    if (left && moveId.current === null) {
      e.currentTarget.setPointerCapture(id);
      moveId.current = id;
      moveOrigin.current = { x, y };
      setStick({ ox: x, oy: y, kx: x, ky: y });
    } else if (!left && lookId.current === null) {
      e.currentTarget.setPointerCapture(id);
      lookId.current = id;
      lookLast.current = { x, y };
    }
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId === moveId.current) {
      const dx = e.clientX - moveOrigin.current.x;
      const dy = e.clientY - moveOrigin.current.y;
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, STICK_R / len);
      const kx = dx * k, ky = dy * k;
      game.setMove(curve(kx / STICK_R), curve(-ky / STICK_R)); // screen y points down, forward is up
      setStick((s) => (s ? { ...s, kx, ky } : s));
    } else if (e.pointerId === lookId.current) {
      game.touchLook(e.clientX - lookLast.current.x, e.clientY - lookLast.current.y);
      lookLast.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId === moveId.current) {
      moveId.current = null;
      game.setMove(0, 0);
      setStick(null);
    }
    if (e.pointerId === lookId.current) lookId.current = null;
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0"
      style={{ touchAction: "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* faint affordances */}
      <div className="absolute bottom-6 left-6 text-[11px] font-bold tracking-[4px] text-white/35" style={{ fontFamily: FONT }}>MOVE</div>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-bold tracking-[4px] text-white/35" style={{ fontFamily: FONT }}>DRAG TO LOOK</div>

      {/* floating move stick */}
      {stick && (
        <>
          <div className="pointer-events-none absolute rounded-full" style={{ left: stick.ox - STICK_R, top: stick.oy - STICK_R, width: STICK_R * 2, height: STICK_R * 2, border: "2px solid rgba(255,255,255,.35)", background: "rgba(255,255,255,.06)" }} />
          <div className="pointer-events-none absolute rounded-full" style={{ left: stick.kx - 26, top: stick.ky - 26, width: 52, height: 52, background: "rgba(255,255,255,.55)", boxShadow: "0 0 6px rgba(0,0,0,.5)" }} />
        </>
      )}

      {/* action buttons */}
      <Btn label="FIRE" size={108} primary style={{ right: 16, bottom: 16 }} on={fire}
        onPress={(d) => { setFire(d); game.setFire(d); }} />
      <Btn label="AIM" size={74} style={{ right: 138, bottom: 24 }} on={ads}
        onPress={(d) => { if (d) { const n = !ads; setAds(n); game.setAds(n); } }} />
      <Btn label="RELOAD" style={{ right: 16, bottom: 132 }}
        onPress={(d) => { if (d) game.reload(); }} />
      <Btn label="JUMP" style={{ right: 92, bottom: 132 }}
        onPress={(d) => { if (d) game.jump(); }} />
      <Btn label="CROUCH" size={56} style={{ right: 170, bottom: 112 }} on={crouch}
        onPress={(d) => { if (d) { game.toggleCrouch(); setCrouch(game.crouch); } }} />
      <Btn label="SPRINT" size={56} style={{ right: 170, bottom: 176 }} on={sprint}
        onPress={(d) => { setSprint(d); game.setSprint(d); }} />
      <Btn label="PAUSE" size={52} style={{ left: 16, top: 204 }}
        onPress={(d) => { if (d) game.pauseGame(); }} />
    </div>
  );
}
