import globals from "globals";

/**
 * The lint step exists mostly to catch identifiers that were left behind when
 * the 4,000 line editor was split into modules: a name that is used but never
 * imported is a `no-undef` error, and `no-undef` is exactly what a split like
 * that can get wrong.
 *
 * The TypeScript sources are checked by `tsc --noEmit` instead, which reports
 * the same class of mistake.
 */
export default [
  {
    files: ["src/**/*.js", "tools/**/*.mjs", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-var": "error",
      "prefer-const": "off",
      eqeqeq: ["error", "smart"],
      "no-console": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "js/**", "static/**", "vendor/**"],
  },
];
