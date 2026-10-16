// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["supabase/functions/**/*.js"],
    languageOptions: {
      globals: { Deno: "readonly" },
    },
    // Deno resolves `npm:` imports at deploy time instead of through Node's resolver.
    rules: { "import/no-unresolved": "off" },
  },
]);
