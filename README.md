# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Azure Static Web Apps

This site is built in GitHub Actions and then uploaded to Azure Static Web Apps. Because the build happens in GitHub Actions, the Vite `VITE_*` values used by the frontend must be set in GitHub repo `Variables` or `Secrets`.

Recommended GitHub repo variables:

- `VITE_API_URL=https://s2ydconnection.com/api`
- `VITE_AGE_VERIFY_API_URL=https://s2ydconnection.com/api/age-verify`
- `VITE_AGE_VERIFY_PUBLIC_URL=https://yoursocialplace.com/age-verify`
- `VITE_AGE_VERIFY_BASE_PATH=/age-verify`
- `VITE_MEDIA_REWRITE_TO_ORIGIN=true`
- `VITE_NEWS_ACCESS_MODE=fallback`
- `VITE_NEWS_API_URL=https://newsapp_backend.rousehouse.net`
- `VITE_NEWS_PROXY_URL=` if you have a dedicated public news proxy; otherwise leave it blank

Required GitHub repo secret:

- `VITE_NEWS_API_KEY`

Notes:

- Azure Static Web Apps portal application settings do not populate Vite build-time env values when the app is built in GitHub Actions.
- If Azure serves the frontend from a hostname that is different from your custom domain, add that origin to Strapi `CORS_ORIGINS`.

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
