import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "android", "ios", ".npm-cache", "playwright-report", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // The React app.
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },

  // Plain browser scripts served as static files, outside the bundle.
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: { ...globals.browser },
    },
  },

  // Build and deploy tooling runs on Node.
  {
    files: ["scripts/**/*.{js,mjs}", "*.config.{js,ts}", "e2e/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
  },

  /**
   * The marketing capture scripts run on Node, but hand callbacks to
   * page.evaluate and addInitScript that are serialised and executed inside the
   * browser — so `document`, `getComputedStyle` and `requestAnimationFrame` are
   * legitimately in scope there, in the same file.
   */
  {
    files: ["scripts/*marketing*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Omitting keys by rest-destructuring is the clearest way to strip
      // provenance columns off a row before it is written as a fixture.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },

  // Edge Functions run on Deno, which supplies its own globals.
  {
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.deno, ...globals.browser },
    },
    rules: {
      // Deno resolves `jsr:` and `https:` specifiers that this config cannot.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
