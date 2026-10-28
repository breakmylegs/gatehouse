# Runbook

How to run Gatehouse day to day. Commands are for PowerShell in the repository folder unless it says otherwise.

## Start and sign in

1. Make sure you are signed in to Claude Code on this computer, with the account for your organisation. Gatehouse never handles your sign-in. It uses the unmodified Claude Code binary, which uses your own login.
2. Start it:

   ```
   pwsh scripts/start.ps1
   ```

   The first start builds the interface (a minute or two). It prints an address ending in `#token=...` and opens it in Edge. The token is new each run and is only in that address. Do not share it. Stop with Ctrl+C.

   To test the start-up without opening anything: `pwsh scripts/start.ps1 -Check`. To also run the phone Relay: `pwsh scripts/start.ps1 -Relay` (see `docs/relay-local.md` for the first-time address).
3. The first run page checks that you are signed in, that your organisation matches, whether a managed policy is in force, and that the Approver is running. If the organisation is not set, enter the name shown in `/status` in Claude Code (for example `ACN - Premium`), save, and start Gatehouse again. Sessions refuse to start until it matches.
4. Open **Sessions**, enter a folder, and start a session.

### Or run it as an exe

`npm run package` makes `dist-app\JCVC\JCVC.exe` with its runtime and application next to it. Double-click it instead of using the script. See `docs/packaging.md`.

### Start at logon (optional, not enabled)

Gatehouse does not start at logon on its own. If you want that, run this once yourself. It opens no browser, so use the address from a terminal start or add `-NoBrowser` and open the printed address when you need it:

```
$action = New-ScheduledTaskAction -Execute pwsh -Argument '-NoProfile -File C:\dev\gatehouse\scripts\start.ps1 -NoBrowser'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName 'Gatehouse' -Action $action -Trigger $trigger -Description 'Starts Gatehouse at logon'
```

Remove it with `Unregister-ScheduledTask -TaskName Gatehouse -Confirm:$false`. The printed address is not saved anywhere, so a logon start is only useful for the phone channel and the background checks, not for the interface.

## Pair a phone, and revoke one

Follow `docs/relay-local.md`. In short: run the Relay, set its https address, then in **Devices** connect the Relay with the one-time token and choose **Show a pairing code**. Type the code on the phone, then confirm that both screens show the same six digits.

To **revoke** a phone, open **Devices**, choose **Revoke** next to it and confirm. The Host forgets the phone's key before it tells the Relay, so the phone is refused straight away even if the Relay is not running. Every revoke is written to the audit log.

## Lost phone

1. Revoke it in **Devices** (above). From that moment nothing it sends is believed.
2. If you want to be sure, use the kill switch on the desktop (the red button in the header) to deny everything waiting, then re-arm.
3. The phone holds only its own keys, not yours, and the passkey needs Face ID. If you also want to cut the Relay's link, rotate the device token (next section).
4. Pair a new phone when you have one.

## Rotate the device token and the push keys

- **Device token** (this computer's key to the Relay): **Devices**, **Rotate device token**. The Relay stops accepting the old token at once and the new one is kept protected by Windows (DPAPI). Paired phones are not affected.
- **Push keys (VAPID)**: stop the Relay and start it with `npm run relay -- --rotate-vapid`. It makes new keys and says so. Each phone then needs to open the app and choose **Turn on notifications** again, because a phone's subscription is tied to the old key.
- **Enrolment token** is single use and replaced each time it is used. It is in the Relay's data folder.

## Update the SDK safely

The Agent SDK and the MCP SDK are pinned to exact versions in `apps/host/package.json`, `apps/approver/package.json` and `apps/companion/package.json`. Do not use a range.

1. Work on a branch. Change the version in each of those files together, then `npm install`.
2. Read what changed in the SDK's types against `docs/sdk-notes.md`. The options Gatehouse relies on are listed there: `canUseTool`, hooks, `permissionMode`, `settingSources`, `outputFormat`, `tools`.
3. Run the whole gate: `npm run lint`, `npm run typecheck`, `npm test`.
4. Run a live check with a scratch folder: `npm run host:cli`, then ask for `npm install left-pad`. You should see the account and organisation checked first, the call escalated, and a denial reach Claude. Then read `.env` and confirm the floor refuses it.
5. If the judge is on, send one benign call and one that tries to send a secret, as in the Phase 7 report.
6. Update `docs/sdk-notes.md` with the new versions and the date, then merge.

If any step fails, keep the old versions. Never loosen `assertSafeOptions` to make an update pass.

## Verify the audit chain

The audit log is one file per month in `%LOCALAPPDATA%\Gatehouse\audit`, each record carrying the hash of the one before.

- With Node: `npm run audit:verify`
- Without Node: `pwsh scripts/verify-audit.ps1`
- In the interface: **Audit log**, the line at the top says "Chain intact" or names the first broken record.

Both command line checks print every problem with its file and line. A cut tail is caught by `head.json`. If the chain is broken, copy the whole folder somewhere safe before doing anything else, and treat it as a sign someone or something edited the log.

## Back up and restore

Copy `%LOCALAPPDATA%\Gatehouse` (audit, `usage.json`, `phone.json`, `config.json`) and the `policy` folder. `phone.json` holds the device token and the Host's phone key protected by DPAPI, so it only opens for the same Windows user on the same machine. On a new machine, pair the phone again.

## Common problems

- **A session will not start and says the organisation does not match.** Open the first run page, or **Settings**, and set the organisation to exactly what `/status` shows. Restart Gatehouse.
- **Nothing reaches the phone.** On **Devices**, if the Relay shows "cannot be reached", start the Relay and check the tunnel. Requests keep waiting on the desktop meanwhile.
- **A request says it is too long for the phone.** The phone can only deny those. Decide on the desktop.
- **The page is blank after an update.** Restart the Host. It serves the files that existed when it started.
- **The Approver shows as down.** The Host restarts it with back-off. Until it is back every request waits for you. If it keeps failing, run `npm run approver` on its own and read the error.
- **Everything is slow.** Many tools run at once on this machine. The Host's own checks have generous limits, but git and PowerShell can be slow while a scanner is busy.
- **The judge is slow.** Its first call can take about 25 seconds. Turn it off in the rules file if that is too long.
