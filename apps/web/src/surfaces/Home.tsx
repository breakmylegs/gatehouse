/**
 * Home: the Codehouse start picture the owner chose (made with ChatGPT, 2 Nov), reached from the command deck. It is a
 * picture, not a menu (owner, 17 Nov: "The start screen never had buttons"), and the window never stops on it: it opens
 * on the main screen (MAIN_ROUTE in store.ts).
 */
export function Home() {
  return (
    <div className="home-screen">
      <div className="home-art">
        <img
          src="./codehouse/start-screen.png"
          alt="Codehouse, a roadhouse at night under a neon sign: AI chat, code, build. Your AI-powered coding house."
        />
      </div>
    </div>
  )
}
