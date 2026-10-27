import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["**/dist/**", "**/dist-demo/**", "**/node_modules/**", ".claude/**", "coverage/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore marks a value that is deliberately unused (for example a rest-sibling).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Tests read untyped JSON replies from the servers they exercise.
    files: ["**/test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
)
