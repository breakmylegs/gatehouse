/**
 * Whether what was typed is a slash command: a slash, then a name (letters, digits, -, _, : or .), then a space or
 * the end. Pasted output that starts with a path (/dev/mapper/..., /usr/bin/x) is not a command and is sent as
 * written (owner, 17 Nov).
 */
export const isCommand = (text: string): boolean => /^\/[A-Za-z][\w:.-]*(?=\s|$)/.test(text)
