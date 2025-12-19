export const generatePackageJson = (slug, dependencies = {}) => JSON.stringify({
  "name": slug,
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "devvit playtest",
    "build:client": "vite build",
    "setup": "node scripts/setup.js", 
    "register": "devvit upload",
    "upload": "devvit upload",
    "validate": "node scripts/validate.js"
  },
  "dependencies": {
    "@devvit/public-api": "latest",
    "@devvit/kit": "latest",
    "@devvit/web": "latest",
    ...dependencies
  },
  "devDependencies": {
    "devvit": "latest",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "terser": "^5.19.0"
  }
}, null, 2);

export const generateDevvitYaml = (slug) => `
name: ${slug}
version: 0.1.0
webroot: webroot
`;

export const generateViteConfig = () => `
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'client',
  base: './',
  assetsInclude: ['**/*.mp3', '**/*.wav', '**/*.ogg', '**/*.glb', '**/*.gltf', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif'],
  build: {
    outDir: '../webroot',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three']
        }
      }
    }
  }
});
`;

export const tsConfig = JSON.stringify({
  "compilerOptions": {
    "target": "es2020",
    "module": "es2020",
    "moduleResolution": "node",
    "lib": ["es2020", "dom"],
    "jsx": "react",
    "jsxFactory": "Devvit.createElement",
    "jsxFragmentFactory": "Devvit.Fragment",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noImplicitAny": false
  },
  "include": [
    "src"
  ]
}, null, 2);

