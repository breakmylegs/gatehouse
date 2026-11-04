# A policy from IT (B37)

IT can add rules to Codehouse on every laptop it manages. The rules can only make Codehouse stricter: deny or escalate more, or switch off one of its allow rules. They can never allow anything. Codehouse checks they came from IT with a signature, and starts no session while they do not check out.

## The folder

`%ProgramData%\Codehouse\managed`, which only an administrator can change. It holds three files:

| File | What it is |
|---|---|
| `policy.yaml` | The rules, in the overlay format (`docs/policy-guide.md`): `version: 1`, then `deny`, `escalate` and `removeAllow`. `allow`, `floor` and anything else are refused. |
| `policy.yaml.sig` | An Ed25519 signature of `policy.yaml`, exactly as it is on disk, in base64. |
| `key.pem` | IT's Ed25519 public key (SPKI PEM). |

No `policy.yaml`: nothing changes. `policy.yaml` without a valid signature, or without the key: no session starts, and the reason is shown. A policy that was working stays in force until a fixed one replaces it.

## Making the key and signing

Once, keeping `it-private.pem` safe and off the laptops:

```
openssl genpkey -algorithm ed25519 -out it-private.pem
openssl pkey -in it-private.pem -pubout -out key.pem
```

Each time `policy.yaml` changes:

```
openssl pkeyutl -sign -rawin -inkey it-private.pem -in policy.yaml -out policy.yaml.bin
certutil -encode policy.yaml.bin policy.yaml.b64
```

Take the base64 lines from `policy.yaml.b64` (without the BEGIN and END lines), join them into one line, and save that as `policy.yaml.sig`. Copy the three files to the folder with your usual deployment tool. Codehouse notices the change by itself.

## An example

```yaml
version: 1
deny:
  - { id: it-no-docker, commands: ["docker *"], message: "IT does not allow Docker on these laptops." }
escalate:
  - { id: it-ask-npm-publish, commands: ["npm publish*"], risk: 80 }
```
