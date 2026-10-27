# Running the Relay on your own computer

The Relay is a small service that passes sealed messages between Gatehouse on your computer and your iPhone. It runs on the same computer as Gatehouse, either directly with Node or in a Podman container. It only ever holds ciphertext, so it needs no trust.

Because it runs on your own computer, the phone can only reach it while that computer is on and connected. That is deliberate: the decision point is your computer.

## What the phone needs

An iPhone only registers a passkey, runs a Home Screen app and accepts push notifications over **https** with a name it can reach. So the Relay needs a public https address, even though it runs on your laptop. Pick one of these (the first is the simplest):

1. **Tailscale.** Install Tailscale on the laptop and the iPhone. On the laptop run `tailscale serve --bg --https=443 http://127.0.0.1:8087`. Your address is `https://<laptop-name>.<tailnet>.ts.net`. Only your own devices can reach it. Push notifications still work because the push service is called from the Relay, not to it.
2. **A Cloudflare tunnel** (`cloudflared tunnel --url http://127.0.0.1:8087`, or a named tunnel). Anyone can reach the address, which is fine because every request needs the passkey, but a named tunnel gives a stable address. A quick tunnel changes each time, which would break the passkey.
3. **Your own Caddy** with `deploy/relay/Caddyfile.snippet`.

The address must stay the same for good: the passkey is tied to it. If it changes you pair the phone again.

## First start (no container)

This is the simplest way and needs only Node, which Gatehouse already uses.

1. Build the phone app once: `npm run relay:build-phone`.
2. Start the Relay, giving it your https address the first time:

   ```
   npm run relay -- --public-url https://<laptop-name>.<tailnet>.ts.net
   ```

   It remembers the address, so after that `npm run relay` is enough. It keeps its data in `%LOCALAPPDATA%Gatehouseelay` and listens on `127.0.0.1:8087` only. It refuses a different address later, because that would break every paired phone.
3. Read the one-time enrolment token from `%LOCALAPPDATA%Gatehouseelayenrol-token.txt`.
4. In Gatehouse, open **Devices**, enter the address and the token, and choose Connect. The token works once. The Relay writes a new one for the next device.

Stop it with Ctrl+C. Restart it after rebuilding the phone app.

## Alternative: Podman

If you would rather keep it in a container, the same image runs under Podman (nothing is Docker-specific):

1. Copy `deploy/relay/.env.example` to `deploy/relay/.env` and set `RELAY_PUBLIC_URL`.
2. `podman compose -f deploy/relay/docker-compose.yml up -d --build`
3. Read the token: `podman compose -f deploy/relay/docker-compose.yml exec gatehouse-relay cat /data/enrol-token.txt`

The container is published on `127.0.0.1:8087` only. Data lives in the `gatehouse-relay-data` volume. The image has not been built on this machine (no container tool was installed when it was written), so treat the first build as a test.

## Pairing the iPhone

1. In Gatehouse, **Devices**, choose **Show a pairing code**.
2. On the iPhone, open your address in Safari, tap Share, **Add to Home Screen**, then open the new icon. Notifications only work from the Home Screen app.
3. Type the code and pair. The phone asks for a passkey (Face ID) and for notification permission.
4. The phone and the computer each show six digits. If they match, choose **They match** on the computer. If they differ, cancel.

To remove a phone, revoke it in Gatehouse. It stops being believed at once, even if the Relay is down.

## Things to check on a real iPhone (cannot be tested without one)

- The Home Screen app keeps its passkey login and shows the unlock screen.
- A push arrives with the screen locked and says only "Approval needed" (and shows the detail after you turn on lock screen detail in the app).
- Tapping the notification opens the request.
- Allow and Deny each ask for Face ID and reach the computer.
- The kill switch from the phone works.
- Turning the computer off or the tunnel down shows "cannot be reached" on the Devices page and does not stop decisions on the computer.

## Updating and backing up

Pull the new code, rebuild the phone app (`npm run relay:build-phone`) and restart the Relay. Its data folder holds the push keys and the paired phones' public keys. Nothing in it is secret except the push keys; losing it means pairing the phone again.

## What the Relay can and cannot do

It can delay or drop messages, so a decision may not arrive. It cannot read a request, forge a decision, replay one, or approve anything: the computer checks the passkey signature, the one-time nonce, the expiry and the payload hash itself.
