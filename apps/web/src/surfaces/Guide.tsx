import { useState } from "react"
import Markdown from "react-markdown"
import { GUIDE } from "../help/content"

/** The user guide: every help article in one place, with its own contents list. */
export function Guide() {
  const [current, setCurrent] = useState(GUIDE[0]?.id ?? "")
  const article = GUIDE.find((a) => a.id === current) ?? GUIDE[0]
  return (
    <div className="mx-auto grid max-w-[1040px] grid-cols-[230px_minmax(0,1fr)] gap-8 p-6 max-[900px]:grid-cols-1">
      <nav aria-label="Guide contents" className="self-start">
        <h1 className="m-0 mb-3">User guide</h1>
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {GUIDE.map((a) => (
            <li key={a.id}>
              <button
                className="sign w-full rounded border-0 bg-transparent px-2.5 py-1.5 text-left text-[15px] font-medium hover:bg-s2 aria-[current=true]:bg-s2 aria-[current=true]:font-semibold"
                aria-current={a.id === current ? "true" : undefined}
                onClick={() => setCurrent(a.id)}
              >
                {a.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {article ? (
        <article className="panel help-body px-7 py-6">
          <h2 className="m-0 mb-3 text-[24px]">{article.title}</h2>
          <Markdown>{article.body}</Markdown>
        </article>
      ) : null}
    </div>
  )
}
