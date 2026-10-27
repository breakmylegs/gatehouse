/**
 * What the phone keeps on itself. The ECDH private key is a non-extractable CryptoKey stored as an object in
 * IndexedDB, so the page's own code can use it but never read its bytes. Nothing sensitive goes in localStorage.
 */
export interface DeviceInfo {
  phoneId: string
  hostPublicKey: string
  rpId: string
  origin: string
  credentialId: string
  name: string
}

export interface Settings {
  /** Show the decrypted detail on the lock screen. Off by default (invariant 9). */
  lockScreenDetail: boolean
}

export interface KeyMaterial {
  privateKey: CryptoKey
  publicKey: string
}

const DB = "gatehouse-phone"
const STORE = "kv"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error("Storage is not available"))
  })
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const q = db.transaction(STORE).objectStore(STORE).get(key)
    q.onsuccess = () => resolve(q.result as T | undefined)
    q.onerror = () => reject(q.error)
  })
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function del(key: string): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const storage = {
  device: () => get<DeviceInfo>("device"),
  setDevice: (d: DeviceInfo) => put("device", d),
  keys: () => get<KeyMaterial>("keys"),
  setKeys: (k: KeyMaterial) => put("keys", k),
  settings: async (): Promise<Settings> => ({
    lockScreenDetail: false,
    ...(await get<Settings>("settings")),
  }),
  setSettings: (s: Settings) => put("settings", s),
  /** Forget this phone entirely. The desktop must revoke it too, which is what makes it stop working. */
  forget: async () => {
    await del("device")
    await del("keys")
  },
}
