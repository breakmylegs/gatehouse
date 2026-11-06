import { dismissSideAnswer, useSideAnswer } from "../lib/btw"
import { Icon } from "./Icon"

/** The answer to a /btw side question, above the prompt box until you put it away. Not part of the conversation. */
export function SideAnswerCard({ sessionId }: { sessionId: string }) {
  const a = useSideAnswer(sessionId)
  if (!a) return null
  return (
    <section aria-label="By the way" className="recap-card panel">
      <span className="flex items-center gap-2 font-semibold">
        <Icon name="checkpoint" />
        By the way: {a.question}
      </span>
      {a.asking ? (
        <p className="m-0 text-[13px] text-mut">Claude is reading the session to answer…</p>
      ) : a.answer ? (
        <p className="m-0 whitespace-pre-wrap text-[14px] leading-relaxed [overflow-wrap:anywhere]">
          {a.answer}
        </p>
      ) : (
        <p role="alert" className="m-0 text-[13px] text-sev">
          {a.error}
        </p>
      )}
      <p className="m-0 text-[12px] text-mut">
        Answered from what was said, without interrupting the session. It is not added to the
        conversation.
      </p>
      <div>
        <button
          type="button"
          className="btn !min-h-7"
          onClick={() => dismissSideAnswer(sessionId)}
        >
          Got it
        </button>
      </div>
    </section>
  )
}
