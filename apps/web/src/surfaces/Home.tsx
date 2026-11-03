import { setRailMode } from "../lib/railMode"
import { useStore } from "../store"

/**
 * Home: the Codehouse start screen the owner chose (made with ChatGPT, 2 Nov), with its Chat, Code and Projects
 * buttons made real: each is a button laid over the one in the picture, the same size and place at any window size.
 */
const SPOTS = [
  { label: "Chat", left: 28.2, go: "chat" as const },
  { label: "Code", left: 43.8, go: "sessions" as const },
  { label: "Projects", left: 59.3, go: "projects" as const },
]

export function Home() {
  const setRoute = useStore((s) => s.setRoute)
  return (
    <div className="home-screen">
      <div className="home-art">
        <img
          src="./codehouse/start-screen.png"
          alt="Codehouse, a roadhouse at night under a neon sign: AI chat, code, build. Your AI-powered coding house."
        />
        {SPOTS.map((s) => (
          <button
            key={s.label}
            type="button"
            className="home-spot"
            style={{ left: `${s.left}%` }}
            onClick={() => {
              setRailMode(s.go === "sessions" ? "code" : "chat")
              setRoute(s.go)
            }}
          >
            <span className="sr-only">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
