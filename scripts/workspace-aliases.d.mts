/** Every @gatehouse entry point as [import name, file], most specific first. */
export function workspaceEntries(): Array<[string, string]>
/** For Vite and Vitest: an exact match for each name. */
export function workspaceAliases(): Array<{ find: RegExp; replacement: string }>
