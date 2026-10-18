// ESLint 9 flat config. The project had no config at all, so `npm run lint` could
// not run (ESLint 9 dropped .eslintrc and the --ext flag). Uses only the plugins
// already in devDependencies.
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "scripts/**", "*.config.*"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: { "@typescript-eslint": tsPlugin, "react-hooks": reactHooks },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
