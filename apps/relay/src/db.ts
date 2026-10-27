import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

export const sha256Hex = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex")
export const token = (bytes = 32): string => randomBytes(bytes).toString("base64url")
export const newId = (): string => randomBytes(16).toString("hex")

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest()
  const hb = createHash("sha256").update(b).digest()
  return timingSafeEqual(ha, hb)
}

export interface DeviceRow {
  id: string
  name: string
}
export interface PairingRow {
  id: string
  device_id: string
  code: string
  challenge: string
  host_pub: string
  expires_at: number
  status: "waiting" | "registered" | "confirmed"
  registration: string | null
  phone_id: string | null
}
export interface PhoneRow {
  id: string
  device_id: string
  name: string
  credential_id: string
  credential_pub: string
  counter: number
  ecdh_pub: string
  push_sub: string | null
}
export interface RequestRow {
  id: string
  device_id: string
  phone_id: string
  sealed: string
  expires_at: number
  priority: string
  resolved_at: number | null
  summary: string | null
  created_at: number
}
export interface EnvelopeRow {
  id: string
  device_id: string
  phone_id: string
  request_id: string | null
  sealed: string
  created_at: number
}

const SCHEMA = `
create table if not exists kv (k text primary key, v text not null);
create table if not exists devices (id text primary key, name text not null, token_hash text not null unique, created_at integer not null);
create table if not exists pairings (
  id text primary key, device_id text not null, code text not null, challenge text not null, host_pub text not null,
  expires_at integer not null, status text not null, registration text, phone_id text, created_at integer not null);
create index if not exists pairings_code on pairings(code);
create table if not exists phones (
  id text primary key, device_id text not null, name text not null, credential_id text not null, credential_pub text not null,
  counter integer not null, ecdh_pub text not null, push_sub text, created_at integer not null);
create table if not exists requests (
  id text primary key, device_id text not null, phone_id text not null, sealed text not null, expires_at integer not null,
  priority text not null, resolved_at integer, summary text, created_at integer not null);
create table if not exists envelopes (
  id text primary key, device_id text not null, phone_id text not null, request_id text, sealed text not null, created_at integer not null);
create table if not exists challenges (id text primary key, phone_id text not null, challenge text not null, expires_at integer not null);
create table if not exists sessions (token_hash text primary key, phone_id text not null, expires_at integer not null);
`

/** All of the Relay's state. Everything sensitive in it is ciphertext or a public key. */
export class Store {
  readonly db: DatabaseSync

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(path.join(dir, "relay.sqlite"))
    this.db.exec("pragma journal_mode = wal; pragma busy_timeout = 5000;")
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  // ---- kv ----
  kvGet(k: string): string | undefined {
    const r = this.db.prepare("select v from kv where k = ?").get(k) as { v: string } | undefined
    return r?.v
  }
  kvSet(k: string, v: string): void {
    this.db
      .prepare("insert into kv (k, v) values (?, ?) on conflict(k) do update set v = excluded.v")
      .run(k, v)
  }

  // ---- devices ----
  addDevice(name: string, tokenValue: string, now: number): DeviceRow {
    const id = newId()
    this.db
      .prepare("insert into devices (id, name, token_hash, created_at) values (?, ?, ?, ?)")
      .run(id, name, sha256Hex(tokenValue), now)
    return { id, name }
  }
  deviceByToken(tokenValue: string): DeviceRow | undefined {
    return this.db
      .prepare("select id, name from devices where token_hash = ?")
      .get(sha256Hex(tokenValue)) as DeviceRow | undefined
  }

  // ---- pairings ----
  addPairing(p: Omit<PairingRow, "status" | "registration" | "phone_id">, now: number): void {
    this.db
      .prepare(
        "insert into pairings (id, device_id, code, challenge, host_pub, expires_at, status, created_at) values (?, ?, ?, ?, ?, ?, 'waiting', ?)",
      )
      .run(p.id, p.device_id, p.code, p.challenge, p.host_pub, p.expires_at, now)
  }
  pairingById(id: string): PairingRow | undefined {
    return this.db.prepare("select * from pairings where id = ?").get(id) as PairingRow | undefined
  }
  pairingByCode(code: string, now: number): PairingRow | undefined {
    return this.db
      .prepare(
        "select * from pairings where code = ? and expires_at > ? order by created_at desc limit 1",
      )
      .get(code, now) as PairingRow | undefined
  }
  registerPairing(id: string, registration: string): boolean {
    const r = this.db
      .prepare(
        "update pairings set status = 'registered', registration = ? where id = ? and status = 'waiting'",
      )
      .run(registration, id)
    return Number(r.changes) === 1
  }
  confirmPairing(id: string, phoneId: string): void {
    this.db
      .prepare("update pairings set status = 'confirmed', phone_id = ? where id = ?")
      .run(phoneId, id)
  }

  // ---- phones ----
  addPhone(p: Omit<PhoneRow, "id">, now: number): string {
    const id = newId()
    this.db
      .prepare(
        "insert into phones (id, device_id, name, credential_id, credential_pub, counter, ecdh_pub, push_sub, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        p.device_id,
        p.name,
        p.credential_id,
        p.credential_pub,
        p.counter,
        p.ecdh_pub,
        p.push_sub,
        now,
      )
    return id
  }
  phoneById(id: string): PhoneRow | undefined {
    return this.db.prepare("select * from phones where id = ?").get(id) as PhoneRow | undefined
  }
  phonesOfDevice(deviceId: string): PhoneRow[] {
    return this.db
      .prepare("select * from phones where device_id = ? order by created_at")
      .all(deviceId) as unknown as PhoneRow[]
  }
  setPhoneCounter(id: string, counter: number): void {
    this.db.prepare("update phones set counter = ? where id = ?").run(counter, id)
  }
  setPushSub(id: string, sub: string | null): void {
    this.db.prepare("update phones set push_sub = ? where id = ?").run(sub, id)
  }
  renamePhone(deviceId: string, id: string, name: string): boolean {
    return (
      Number(
        this.db
          .prepare("update phones set name = ? where id = ? and device_id = ?")
          .run(name, id, deviceId).changes,
      ) === 1
    )
  }
  /** Revoking removes the phone, its sessions, its challenges, its pending requests and any envelopes it left. */
  deletePhone(deviceId: string, id: string): boolean {
    const r = this.db.prepare("delete from phones where id = ? and device_id = ?").run(id, deviceId)
    if (Number(r.changes) !== 1) return false
    for (const t of ["sessions", "challenges", "requests", "envelopes"])
      this.db.prepare(`delete from ${t} where phone_id = ?`).run(id)
    return true
  }

  // ---- requests ----
  putRequest(r: Omit<RequestRow, "resolved_at" | "summary" | "created_at">, now: number): void {
    this.db
      .prepare(
        "insert or replace into requests (id, device_id, phone_id, sealed, expires_at, priority, created_at) values (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(r.id, r.device_id, r.phone_id, r.sealed, r.expires_at, r.priority, now)
  }
  requestById(id: string): RequestRow | undefined {
    return this.db.prepare("select * from requests where id = ?").get(id) as RequestRow | undefined
  }
  resolveRequest(deviceId: string, id: string, summary: string, now: number): boolean {
    const r = this.db
      .prepare("update requests set resolved_at = ?, summary = ? where id = ? and device_id = ?")
      .run(now, summary, id, deviceId)
    return Number(r.changes) === 1
  }
  pendingForPhone(phoneId: string, now: number, recentMs: number): RequestRow[] {
    return this.db
      .prepare(
        "select * from requests where phone_id = ? and ((resolved_at is null and expires_at > ?) or resolved_at > ?) order by created_at",
      )
      .all(phoneId, now, now - recentMs) as unknown as RequestRow[]
  }

  // ---- envelopes ----
  addEnvelope(e: Omit<EnvelopeRow, "id" | "created_at">, now: number): string {
    const id = newId()
    this.db
      .prepare(
        "insert into envelopes (id, device_id, phone_id, request_id, sealed, created_at) values (?, ?, ?, ?, ?, ?)",
      )
      .run(id, e.device_id, e.phone_id, e.request_id, e.sealed, now)
    return id
  }
  envelopesFor(deviceId: string): EnvelopeRow[] {
    return this.db
      .prepare("select * from envelopes where device_id = ? order by created_at")
      .all(deviceId) as unknown as EnvelopeRow[]
  }
  ackEnvelope(deviceId: string, id: string): void {
    this.db.prepare("delete from envelopes where id = ? and device_id = ?").run(id, deviceId)
  }

  // ---- challenges and sessions ----
  addChallenge(phoneId: string, challenge: string, expiresAt: number): string {
    const id = newId()
    this.db
      .prepare("insert into challenges (id, phone_id, challenge, expires_at) values (?, ?, ?, ?)")
      .run(id, phoneId, challenge, expiresAt)
    return id
  }
  /** A challenge can be used once. Taking it removes it. */
  takeChallenge(phoneId: string, challenge: string, now: number): boolean {
    const r = this.db
      .prepare("delete from challenges where phone_id = ? and challenge = ? and expires_at > ?")
      .run(phoneId, challenge, now)
    return Number(r.changes) === 1
  }
  addSession(tokenValue: string, phoneId: string, expiresAt: number): void {
    this.db
      .prepare("insert into sessions (token_hash, phone_id, expires_at) values (?, ?, ?)")
      .run(sha256Hex(tokenValue), phoneId, expiresAt)
  }
  sessionPhone(tokenValue: string, now: number): string | undefined {
    const r = this.db
      .prepare("select phone_id from sessions where token_hash = ? and expires_at > ?")
      .get(sha256Hex(tokenValue), now) as { phone_id: string } | undefined
    return r?.phone_id
  }

  /** Everything past its time goes, every minute. Nothing here is worth keeping after it has expired. */
  purge(now: number): void {
    const q = (sql: string, ...args: number[]) => this.db.prepare(sql).run(...args)
    q(
      "delete from requests where expires_at < ? and (resolved_at is null or resolved_at < ?)",
      now - 60_000,
      now - 600_000,
    )
    q("delete from envelopes where created_at < ?", now - 10 * 60_000)
    q("delete from pairings where expires_at < ?", now - 60_000)
    q("delete from challenges where expires_at < ?", now)
    q("delete from sessions where expires_at < ?", now)
  }
}
