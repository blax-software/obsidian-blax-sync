// Obsidian's own rules: the community directory's automated review runs the same set.
import { defineConfig, globalIgnores } from 'eslint/config'
import obsidianmd from 'eslint-plugin-obsidianmd'

export default defineConfig([
  globalIgnores(['node_modules', 'main.js', 'esbuild.config.mjs', 'scripts', 'tests']),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ['eslint.config.*'] } },
    },
  },
])
