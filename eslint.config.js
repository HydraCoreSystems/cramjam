// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Apostrophes are plain text in this app's copy. Escaping each one would make the strings unreadable.
    rules: { 'react/no-unescaped-entities': 'off' },
  },
]);
