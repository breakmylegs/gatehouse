// Types for scripts/related-tests.mjs, for the tests that import it.
export declare function codeFiles(base?: string): string[]
export declare function resolveImport(fromFile: string, spec: string): string | undefined
export declare function relatedTests(changed: string[], files?: string[]): string[]
export declare function directTests(changed: string[], files?: string[]): string[]
