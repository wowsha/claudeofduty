import { useEffect, useRef, useState } from "react";
import { Game } from "./game/game";
import Hud from "./hud/Hud";

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const created = useRef(false);

  useEffect(() => {
    if (created.current || !host.current) return;
    created.current = true;
    setGame(new Game(host.current));
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div ref={host} className="absolute inset-0" style={{ touchAction: "none" }} />
      {game && <Hud game={game} />}
    </div>
  );
}
