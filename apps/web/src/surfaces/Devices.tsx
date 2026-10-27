import { useStore } from "../store"

/** The phone relay arrives in Phase 6. Until it is configured this page says so plainly and shows nothing invented. */
export function Devices() {
  const relay = useStore((s) => s.health?.relay)
  return (
    <div className="mx-auto grid max-w-[760px] gap-4 p-6">
      <h1 className="m-0 text-lg font-semibold">Devices and pairing</h1>
      {!relay || relay.state === "not-configured" ? (
        <section className="panel grid gap-2 p-5" aria-label="Phone relay status">
          <h2 className="m-0 text-base font-semibold">No phone is paired</h2>
          <p className="m-0">
            Decisions are made on this computer only. To decide from your iPhone as well, set up the
            relay on your server and pair the phone. The steps are in the runbook.
          </p>
          <p className="m-0 text-mut">Nothing is sent off this computer until you do.</p>
        </section>
      ) : relay.state === "unreachable" ? (
        <p role="alert" className="m-0 font-semibold text-sev">
          The relay is set up but cannot be reached. Requests still reach this computer.
        </p>
      ) : (
        <p className="m-0">
          Relay connected. {relay.devices} device{relay.devices === 1 ? "" : "s"} paired.
        </p>
      )}
    </div>
  )
}
