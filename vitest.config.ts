import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
export default defineConfig({ optimizeDeps: { include: ['three', 'three/addons/loaders/GLTFLoader.js'] }, test: { include: ['__test__/**/*.test.ts'], browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] } } });
