# Policy guide

This guide describes how Gatehouse decides what an agent may do. It matches the code in `packages/policy` and the seed rules in `policy/rules.yaml`. If the two ever disagree, the golden tests in `packages/policy/test/golden/` are the reference.

## 1. How a decision is made

Every tool call is evaluated in this order. The first stage that produces a verdict ends the evaluation.

| Stage | Result | Notes |
|---|---|---|
| Policy loaded? | escalate `policy-unavailable` | No valid policy means nothing is allowed automatically. |
| Floor | deny | Secrets files, obfuscated shell, critical paths. Cannot be overridden by anything. |
| Malformed input | escalate `malformed-input` | The tool input lacks the field the policy needs. |
| Deny rules | deny | Base rules plus the project overlay. Deny wins over every later stage. |
| Parse error, parser down | escalate `parse-error`, `pwsh-unavailable` | The command cannot be understood, so a person decides. |
| Remember rules | allow for that segment or call | Exact command or exact path only. Cannot override the floor, deny rules or built-in escalations. |
| Built-in escalations | escalate | Heredocs, `eval`, dynamic segments, redirect writes, PowerShell risks. |
| Escalate rules | escalate | The highest risk wins when several match. |
| Allow rules | allow | Every shell segment must be allowed, and every path must satisfy path constraints. |
| Default | escalate `no-rule` or `unknown-tool` | Anything not allowed is escalated. |

Failure handling follows invariant 1: if evaluation throws, the verdict is escalate `engine-error`. The engine never throws and never allows on an error.

The verdict carries the rule id, a plain-language reason, a risk score from 0 to 100, the policy hash and, for shell commands, one entry per segment. Deny is always 100, allow is at most 20, escalate takes the rule's `risk` (default 50).

## 2. Rules file

`policy/rules.yaml` is YAML validated against a JSON Schema. It is reloaded when it changes. A file that fails validation never replaces a policy that loaded, and the errors are reported by `policy_status`.

```yaml
version: 1
workspaceRoots: ["C:/dev", "C:/Users/<you>/source"]   # <you> becomes the Windows user name
defaults: { unknownTool: escalate, parseError: escalate, judge: { enabled: false } }
quietHours: { start: "22:00", end: "07:00", tz: "Europe/London", phone: false }
floor: [ ... ]      # deny only
deny: [ ... ]
escalate: [ ... ]
allow: [ ... ]
judgeEligible: [network]
```

`unknownTool` and `parseError` can only be `escalate`. Rule ids are lower case letters, digits and hyphens, and must be unique across every section and every overlay.

### Rule fields

| Field | Meaning |
|---|---|
| `id` | Unique rule id. Appears in every verdict and the audit log. |
| `tools` | Tool names. `*` is a wildcard. Case sensitive. |
| `exceptTools` | Tool names the rule never applies to. |
| `commands` | Shell command patterns, matched per segment. |
| `pathGlobs` | Globs over the target paths. |
| `pathInside` / `pathOutside` | `workspaceRoots`: the target is inside or outside every workspace root. |
| `pathUnc` | `true`: the target is a UNC path or a device path. |
| `mcpSource` | Where an MCP server came from, as the SDK reports it (`sdk` is the Companion). Allow rules need a listed source; deny and escalate rules skip a call only when its source is known and not listed. |
| `sessionKinds` | `[chat]`, `[code]` or both: the kinds of session the rule applies in (CH-03, ADR 0012). A call that does not say counts as a coding session. A kind not in that list stops the rules from loading. |
| `everySegmentMustMatch` | Optional, only `true` is accepted. Allow rules always need every segment. |
| `risk` | 0 to 100, for escalate rules. |
| `message` | Reason shown to the agent and the user. |
| `powershell`, `bash` | Floor flags (section 5). |

A rule needs at least one selector, otherwise the loader rejects it. A rule that would match everything is a mistake.

### How selectors combine

- `tools` and `commands` are alternatives. A rule is selected when the tool name matches **or** a shell segment matches a command pattern. This is what lets the seed `network` rule cover `WebFetch` and `curl` together.
- Path constraints (`pathGlobs`, `pathInside`, `pathOutside`, `pathUnc`) then apply to the call's target paths, and all the constraints you give must hold for the same target.
- For **allow** rules, every target must satisfy the constraints. A call with no targets does not match a rule that has path constraints.
- For **deny**, **escalate** and **floor** rules, one target is enough.
- `exceptTools` removes tools from the match.
- An allow rule must have `tools` or `commands`, and cannot use `pathOutside`, `pathUnc` or the floor flags. The loader rejects them.

### Targets

The targets of a call are:

| Tool | Targets |
|---|---|
| Read, Edit, Write, MultiEdit | `file_path` |
| NotebookEdit | `notebook_path` |
| Grep, Glob | `path`, defaulting to the working directory |
| WebFetch | the path of a `file:` URL, otherwise none |
| Bash, PowerShell | every word that looks like a path (contains a slash, starts with `.` or `~`, has a drive letter, a wildcard, or a short-name marker such as `~1`) |

Glob words in a shell command are expanded against the folder on disk, so `cat .en?` is seen as `.env`. Bash `*` skips dot files. PowerShell wildcards include them, so `Get-ChildItem *` in a folder holding `.env` reaches a secret.

## 3. Command patterns

A pattern is matched against the whole text of one segment.

- `*` matches any run of characters, including none, spaces and slashes. Everything else is literal. `git status*` matches `git status`, `git status --short` and also `git statusx`. Write `git status *` to require a space (the command then needs an argument).
- PowerShell segments match case-insensitively. Bash segments are case sensitive.
- The text is normalised first: quotes and escapes are removed, runs of spaces become one space, and PowerShell aliases become the full cmdlet name (`gci` and `ls` become `Get-ChildItem`, `iex` becomes `Invoke-Expression`, `Microsoft.PowerShell.Utility\Invoke-Expression` becomes `Invoke-Expression`).
- Environment assignments in front of a command are part of the text, so `GIT_PAGER=cat git status` does not match `git status*` and is escalated.
- For deny rules only, leading wrappers are also stripped before matching: `env`, `command`, `builtin`, `nohup`, `time`, `exec`, `sudo`, `doas`, `nice`, `stdbuf`, `timeout`. So `sudo rm -rf /` hits `rm -rf /*`. Allow rules never ignore a wrapper.

### What counts as a segment

Every simple command, wherever it sits: either side of `&&`, `||`, `;`, `|` and newlines, inside `( )` and `{ }`, inside `$( )` and backticks, inside `<( )`, inside function bodies, and inside the payload of `bash -c` or `pwsh -Command` when the payload is plain text. **For a call to be allowed, every segment must be allowed.** One unmatched segment escalates the whole call.

A segment is never allowed by a pattern when it:

- contains a variable, command substitution, arithmetic or brace expansion (`dynamic-segment`),
- redirects output to a file other than the null device (`shell-redirect-write`). `2>&1` and `> /dev/null` are fine.

### Escalations that need no rule

These are built in and cannot be switched off:

| Rule id | Trigger | Risk |
|---|---|---|
| `parse-error` | The text does not parse | 50 |
| `pwsh-unavailable` | The PowerShell parser is not running | 50 |
| `malformed-input` | A required input field is missing | 50 |
| `bash-heredoc` | A heredoc | 60 |
| `bash-eval` | `eval` with a plain-text argument | 80 |
| `dynamic-segment` | An expansion in the command | 55 |
| `shell-redirect-write` | Output redirected to a file | 60 |
| `pwsh-start-process` | `Start-Process`, `saps`, `start` | 85 |
| `pwsh-scriptblock-create` | `[ScriptBlock]::Create`, `InvokeScript`, `NewScriptBlock`, `ExpandString` | 85 |
| `pwsh-add-type` | `Add-Type` | 85 |
| `pwsh-download-string` | `DownloadString`, `DownloadFile` and similar | 85 |
| `pwsh-registry-write` | Registry changes, including `reg add` and `reg delete` | 85 |
| `pwsh-execution-policy` | `Set-ExecutionPolicy` | 85 |
| `shell-obfuscation` | Encoded, dynamic or piped-to-shell forms that the floor is not configured to deny | 90 |
| `no-rule` | Nothing allows the call | 50 |
| `unknown-tool` | The tool name is not in the policy | 50 |
| `engine-error`, `policy-unavailable` | The engine failed, or no policy is loaded | 50 |

A tool is "known" when it is one of Read, Edit, Write, MultiEdit, NotebookEdit, Bash, PowerShell, Grep, Glob, WebFetch, WebSearch, or when a rule names it. To let the agent use `TodoWrite` without asking, add an allow rule with `tools: [TodoWrite]`.

## 4. Paths

Paths are resolved the way Windows resolves them.

- Separators are normalised, drive letters and folder names compare case-insensitively, and Git Bash forms (`/c/dev`, `/mnt/c/dev`) become drive paths. `~` is the home folder.
- Symbolic links, junctions and 8.3 short names are followed with the real path on disk. A junction that points outside the workspace counts as outside, for existing files and for files that do not exist yet. `link\..` is resolved after following the junction, as Windows does.
- Trailing dots and spaces in a name are ignored, and `name::$DATA` is the file `name`. So `.env.`, `.env ` and `.env::$DATA` are all `.env`.
- UNC paths (`\\server\share`) and device paths (`\\?\`, `\\.\`) are never resolved. They are escalated by the seed `unc-path` rule, and denied for writes by `outside-workspace-write`.
- Globs in a rule are relative to the **project root**, which is the git root of the working directory (a `.git` folder or file), or the working directory itself if there is none. Allow rules match the relative path only. Other rules match the relative path or the absolute one.
- Parentheses in globs are literal (`C:/Program Files (x86)/**`). Extended glob syntax is not supported.
- Everything is Windows-oriented. Do not rely on this package for POSIX path semantics.

## 5. The floor

The floor is checked before anything else and can only deny. Its result type has no way to express "allow".

| Seed rule | Denies |
|---|---|
| `secrets-files` | Any word or target that matches `**/.env`, `**/.env.*`, `**/*.pem`, `**/*.pfx`, `**/*.key`, `**/id_rsa*`, `**/id_ed25519*`, `**/.aws/**`, `**/.azure/**`, `**/.ssh/**` or `**/.claude/.credentials.json`, through any listed tool. |
| `obfuscated-shell` | `-EncodedCommand` and its abbreviations (`-e`, `-enc`, `-ec`), `Invoke-Expression` and `iex`, dynamic invocation (`& $x`, `. $x`, `& ("a"+"b")`), `eval` with an expansion, `bash -c "$x"`, piping into `sh`, `bash`, `zsh`, `dash`, `ksh`, `pwsh`, `cmd` and the like (also through `sudo` and `env`), and `bash <(...)`. |
| `critical-paths` | Words or targets under `C:/Windows`, `C:/Program Files`, `C:/Program Files (x86)`, for Edit, Write, MultiEdit, Bash and PowerShell. |

Notes on how the floor reads a call:

- It looks at **every word** of a shell command, not only arguments that are obviously paths, and also at the part after `=` or `:` in `--file=.env` and `-Path:.env`.
- Words with an expansion are checked with a placeholder, so `cat "$HOME/.ssh/id_rsa"` is denied.
- If a command does not parse, the floor still checks the raw words.
- It can be too cautious on purpose: `git add .env.example` is denied because `.env.example` matches `**/.env.*`, and `echo .env` is denied. Remember rules cannot lift a floor denial.
- A recursive `Grep` or `Glob` over a folder cannot be checked for secrets inside it, because the floor only sees the call, not the files. This is a known gap for a later phase.
- ANSI-C quoting (`$'\x2eenv'`) is not decoded. Such a command is not allowed by any rule, so it escalates.

## 6. Project overlays

`policy/projects/<name>.yaml` applies to the project whose git root folder has that name (case-insensitive).

```yaml
version: 1
deny:
  - { id: client-a-no-curl, commands: ["curl*"] }
escalate:
  - { id: client-a-review-git, commands: ["git log*"], risk: 90 }
removeAllow: [safe-shell]
```

An overlay can **only tighten**: add deny rules, add escalate rules, or remove allow rules by id. The loader rejects the whole policy if an overlay has `allow`, `floor`, `workspaceRoots`, `defaults`, `quietHours` or `judgeEligible`, an unknown key, a `project` that differs from the file name, a rule with no selector, a rule id already in use, or a `removeAllow` that names no allow rule. A broken overlay never loads partially, because dropping a deny rule would loosen the policy.

## 7. Remember rules

`policy/rules.local.yaml` is written by the desktop UI only. The phone cannot create these.

```yaml
version: 1
remember:
  - { id: npm-lodash, tool: Bash, command: "npm install lodash" }
  - { id: util-edit, tool: Edit, path: "C:/dev/app/lib/util.js" }
```

- Exactly one of `command` or `path`. A command needs tool Bash or PowerShell. A path needs Read, Edit, Write, MultiEdit or NotebookEdit and an absolute drive path.
- A command rule matches one segment whose text is **exactly** the command (PowerShell ignores case). It never matches a dynamic segment or a segment that writes with a redirect.
- A path rule matches when every target of the call is that exact path.
- Verdicts from a remember rule use the rule id `remember-<id>`.
- Remember rules are checked after the floor and deny rules, so they cannot cover a floor or deny category. They are checked before escalate rules, which is how they can allow `npm install lodash`. They cannot suppress the built-in escalations in section 3.

### Lifetimes, scope and uses (C-013)

Each rule remembered from now on carries limits, kept beside it in `policy/rules.local.meta.json` so that an older Codehouse still reads `rules.local.yaml` as before:

```json
{ "version": 1, "grants": { "npm-lodash": { "expiresAt": "2026-12-09T12:00:00.000Z", "scope": "C:/dev/app", "maxUses": 10 } } }
```

- `expiresAt`: after this time the rule no longer allows, and the call asks as it would without it. By default 30 days after it was remembered; you may choose 1, 7, 30 or 90 days, or until you remove it.
- `scope`: the rule allows only in this folder and below it (compared after resolving links and 8.3 names). By default the session's folder; you may choose any folder.
- `maxUses`: how many calls it may allow. The Host counts each tool call once, in `%LOCALAPPDATA%\Gatehouse\grant-uses.json`; when none are left, the call asks with the reason "has allowed its N uses". No limit by default.
- Fail closed: an expiry that cannot be read counts as passed, a scope that is not a string matches no folder, a use limit that is not a positive whole number allows none, and a counts file that cannot be read counts every limited rule as used up.
- Rules remembered before C-013 have no limits and keep working as they did. Removing a rule removes its limits.

### The test integrity pack (D-001)

Built into the engine, beside the hidden-character check, and like it no rule or remembered rule can let it through. It looks at Write, Edit and MultiEdit to a test file or test config, and at shell commands, and escalates at High risk (70, so Auto and Accept edits ask too) with a reason naming what weakens the tests. The rule id is `test-integrity-<pattern>`:

| Pattern | What it catches |
|---|---|
| `assertion-removed` | Fewer assertions than before: `expect(`, `assert`, `self.assert*`, `Should`, `Assert.*`. A Write is compared with the file as it is. |
| `skip-added` | A skip or only marker added: `.skip`, `.only`, `.todo`, `xit`, `xdescribe`, `fit`, `[Ignore]`, `[Skip]`, `Skip = "..."`, `@pytest.mark.skip`/`skipif`/`xfail`, `@unittest.skip`, `pytest.skip(`, Pester `-Skip`. |
| `expected-changed` | An assertion kept with the same shape but a different expected value (strings and numbers compared). |
| `test-deleted` | A test file deleted (`rm`, `del`, `Remove-Item`, `git rm`) or written empty. |
| `coverage-lowered` | A coverage threshold lowered or taken out in test config (`lines`, `branches`, `functions`, `statements`, `fail_under`, `threshold`, `minimum`). |
| `failure-hidden` | `|| true`, `|| exit 0`, `--passWithNoTests`, `continue-on-error: true` or `--no-verify` added to a test file or config, a test run made to pass whatever happens, or a commit or push with `--no-verify`. |
| `shell-edit` | A test file changed from the shell (`sed -i`, `perl -i`, a redirect, `Set-Content` and the like), where the guard cannot see what changes. |

Test files are found by convention: a `test`, `tests`, `spec` or `__tests__` folder; `*.test.*` and `*.spec.*`; `test_*.py`, `*_test.py` and `conftest.py`; `*Test.cs` and `*Tests.cs`; `*.Tests.ps1`; `*_test.go`. Test config: the vitest, jest, karma, playwright and cypress configs, `.mocharc`, `pytest.ini`, `tox.ini`, `.coveragerc`, `setup.cfg`, `pyproject.toml`, `codecov.yml`, `.nycrc`, `*.runsettings`, `PesterConfiguration.psd1`, workflow files and `package.json`.

In Extreme approval the Host decides what happens to such an escalation per project (Settings, Sessions, Test integrity): by default it is approved and the session says its tests were weakened; a strict project waits for a person. Every one is recorded as `test_integrity_escalated` with its pattern before it is decided, and refused if the record fails.

### Built-in floor rules (D-002)

One floor rule is built into Codehouse and checked before the rules file's own, so no rules file can leave it out: `sealed-checks` denies every tool any path under `Gatehouse/sealed` or `Gatehouse/heldout-runs`, wherever Codehouse's data folder is, in either slash and any case. That is where the sealed held-out checks are kept and run. A second, `test-locks`, does the same for `Gatehouse/locks`, where the pins of locked tests are kept (D-007).

### What a shell call also runs (D-013)

Before a Bash or PowerShell call is decided, the engine reads what it would also run (`expand.ts`; files are read, never run): an npm, pnpm or yarn script with its pre and post scripts, the lifecycle scripts of an install, and the scripts those call, a few levels deep and never round a loop; the recipe of a make target and of the targets it needs; the git hooks a git command fires (commit, push, merge, pull, checkout, switch, rebase, am), from `core.hooksPath` or `.git/hooks`, unless `--no-verify` skips them; a `.cmd` or `.bat` run by name or path; the local tool `npx` would run, or that it would fetch one; a local dotnet tool from `.config/dotnet-tools.json`; and, for PowerShell without `-NoProfile`, your profile. Each line is judged like the call. A deny on any line denies the call (its reason says which line, from where). A line a rule escalates (network, a package install, a push, a variable) makes the call ask when it is stricter than the call itself. What cannot be read escalates as `unknown-effects` (risk 60). A line no rule speaks of (an ordinary `vitest run`) does not by itself make the call ask, so a test script does not turn every `npm test` into a question. The lines go on the verdict (`expanded`, `unknownEffects`) and are shown on the desktop and phone cards under Also runs.

## 8. Redaction

`redact()` and `redactString()` remove tokens, keys, Authorization headers, JWTs, connection strings, credentials in URLs, private key blocks and `key=value` secrets, plus any terms in the user's list (client names, internal host names). Strings under keys that look secret (`password`, `token`, `api_key` and so on) are replaced whole. Numbers are left alone. It never mutates its input. It is applied before anything is written to the audit log or sent to the relay.

## 9. Golden tests

`packages/policy/test/golden/*.yaml` hold the cases. Each line is one call and the verdict it must get:

```yaml
- { t: Bash, cmd: "git status && git push", o: escalate, r: git-remote }
- { t: Write, p: "link/new.txt", o: deny, r: outside-workspace-write, needs: junction }
```

`t` tool, `cmd` command, `p` path, `g` glob, `url`, `q` query, `in` raw input, `cwd`, `o` outcome, `r` rule id. `needs` skips a case that needs a junction or an 8.3 name on the machine, and the suite fails if more than 10 are skipped. `${WS}`, `${WSW}`, `${OUT}`, `${LONG}`, `${SHORT}` and `${ENV8}` stand for the fixture folders. `kind: overlay` and `kind: remember` write an overlay or a remember file for the case, and `load: reject` expects the policy to fail to load with the text in `err`.

The suite also checks that it is not passing by finding nothing: a minimum number of cases per category and per outcome, every seed rule id expected at least once, and the PowerShell worker actually used.

To add a rule safely: write the goldens first, run `npm test`, then change `rules.yaml`, then replay (next section).

## 10. Replaying a candidate policy

```
npm run policy:replay -- --rules <candidate.yaml> --audit <audit.jsonl>
```

It re-evaluates every recorded call under the candidate rules and lists the ones whose outcome would change. Useful options: `--rule-changes` also lists decisions that keep their outcome but change rule id, `--overlays <dir>`, `--local <file>`, `--workspace-root <dir>` (repeatable), `--json`. A candidate that does not load prints its errors and exits with code 1.

A line in the audit file needs `tool` (or `toolName`), `input`, `cwd`, and `verdict.outcome` with `verdict.ruleId`. Lines that cannot be read are counted and listed as skipped. The audit input is already redacted, so a call that depended on redacted text may replay differently.

## 11. Known limits

- The deny patterns match text, not intent. `rm -r -f /`, `rm -fr /` and `Remove-Item x -Force -Recurse` are not recognised as the destructive patterns, so they escalate to a person instead.
- Path words are read from the command text. Anything computed at run time cannot be resolved, so it escalates as `dynamic-segment` and is never allowed automatically.
- The checks are made before the command runs. A file that changes between the check and the run is not covered.
- Windows managed policy may be stricter. Gatehouse can only add restrictions on top of it.

## 12. Packs, your rules and the plain choices

Packs (`policy/library/*.yaml`) do nothing until your rules file (`rules.user.yaml`) switches them on. Your rules file can also switch off built-in allow or escalate rules (`disabled`) and holds rules of yours (ids start `my-`). The floor and the deny rules can never be switched off: listing one is a load error.

An ask beats an allow (section 1), so a pack that allows what a built-in rule asks about lists that rule in `turnsOff`. It is switched off only while the pack is on. A floor or deny id in `turnsOff` is a load error; an id that is not loaded (its own pack is off) is ignored. `packages` turns off the install asks of `package-install` and the language packs, and asks again for whole-computer installs; `web-read` turns off `network` and asks again for downloads.

The Policy page's **Your choices** view (`apps/web/src/lib/choices.ts`) is a plain layer over the same file: each choice owns some packs, switched-off rules and rules of yours, and reads back as "custom" when they were changed some other way. It only ever switches packs, switches off `edit-workspace-source`, or adds the deny rule `my-codeh-no-push`.

## 13. The judge, insights and the digest

**The judge** is off. To turn it on, set `defaults.judge.enabled: true` in the rules file (Policy, Edit and activate). It is a separate one-turn question to a small model, with no tools, that can only turn an escalation into an allow, and only for a rule listed in `judgeEligible` (the seed lists `network`). It is shown the tool name, the parsed segments and the rule, nothing else: never the transcript, file contents or web content. It is not asked at all when the input is longer than `maxInputChars`, or reads like an instruction to it. A wrong-shaped answer, low confidence (under 0.85), an error or a timeout all leave the call escalated. An allow by the judge carries the rule id `judge:<rule>`, `decidedBy: judge`, and its reasoning in the audit record. While it is on, the Host waits up to 35 seconds for the Approver instead of 15, so a judge-eligible call can take a while to reach you.

**Insights** (Policy, Insights) work out, from the audit log only, how often each rule asked you, how often you approved, and how long you took. **Suggested rules** are calls you approved at least three times and never refused. Each is one exact command or file, is checked again with the same test the Remember button uses, and is added only when you choose Add this rule on the desktop.

**The digest** is a short summary of the last 24 hours sent to the phone once a day after the time in Settings (08:00 by default), and shown at the foot of the Sessions page.
