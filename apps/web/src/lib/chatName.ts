/** What names a chat: the start of its first message, on one line. The whole message is sent as the prompt. */
export const chatName = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 200)
