export type { DeviceInfo, KeyMaterial, Settings } from "../storage"
let settings = { lockScreenDetail: false }
export const storage = {
  device: async () => ({
    phoneId: "ph1",
    hostPublicKey: "h",
    rpId: "x",
    origin: "https://x",
    credentialId: "c",
    name: "Peter's iPhone with a rather long name",
  }),
  keys: async () => ({ privateKey: {} as CryptoKey, publicKey: "k" }),
  settings: async () => settings,
  setSettings: async (s: typeof settings) => void (settings = s),
  forget: async () => undefined,
  setDevice: async () => undefined,
  setKeys: async () => undefined,
}
