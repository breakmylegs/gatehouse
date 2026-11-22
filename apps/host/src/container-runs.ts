/**
 * E-026, container runs (Expansion E3). When Podman is on this computer and Settings allow it, the heavy jobs Codehouse
 * runs itself (held-out and sealed checks, a mutation run's test reruns, a breaker's tests) run in a container: no
 * network, the project mounted read-only, a scratch volume of its own. Off unless switched on. Without Podman the
 * feature says it is unavailable, and jobs run as before (in their job object at the session's level).
 */
import path from "node:path"
import type { ContainerRun } from "./codehouse-action.js"
import type { DoctorCheck } from "./doctor.js"
import { findOnPath } from "./welcome.js"

export interface ContainerSettings {
  enabled?: boolean
  /** The image to run in. Absent: a small Node image. */
  image?: string
}

export const DEFAULT_IMAGE = "docker.io/library/node:22-alpine"

/** An image name Podman can take as one argument, and nothing that could read as an option. */
export const validImage = (image: string) => /^[a-z0-9][a-z0-9._/:@-]{0,254}$/i.test(image)

/** Podman's path, when it is on PATH. */
export const findPodman = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, exists?: (p: string) => boolean) =>
  findOnPath("podman", platform === "win32" ? { ...env, PATHEXT: ".EXE" } : env, platform, exists)

/** The container a session's heavy job runs in, or undefined when it runs as before. */
export function containerFor(s: ContainerSettings | undefined, podman: string | undefined, dataDir: string, sessionId: string): ContainerRun | undefined {
  if (!s?.enabled || !podman) return undefined
  const image = s.image && validImage(s.image) ? s.image : DEFAULT_IMAGE
  return { exe: podman, image, scratch: path.join(dataDir, "container-scratch", sessionId.replace(/[^\w-]/g, "_")) }
}

/** Doctor's line: on, off, or unavailable without Podman. */
export function containerCheck(s: ContainerSettings | undefined, podman: string | undefined): DoctorCheck {
  const base = { id: "container-runs", label: "Container runs" }
  if (!podman)
    return {
      ...base,
      state: s?.enabled ? "warn" : "ok",
      detail: "Unavailable: Podman is not on this computer, so heavy checks run in their job as before.",
      ...(s?.enabled ? { fix: "Install Podman (podman.io) and start its machine, or switch container runs off in Settings." } : {}),
    }
  if (!s?.enabled) return { ...base, state: "ok", detail: "Off. Podman is here; switch container runs on in Settings to run heavy checks with no network and the project read-only." }
  if (s.image && !validImage(s.image)) return { ...base, state: "warn", detail: `On, but the image name is not one Codehouse accepts, so ${DEFAULT_IMAGE} is used.`, fix: "Correct the image name in Settings." }
  return { ...base, state: "ok", detail: `On: heavy checks run in ${s.image || DEFAULT_IMAGE} with no network, the project read-only and a scratch volume.` }
}
