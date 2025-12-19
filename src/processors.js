import * as acorn from 'https://esm.sh/acorn@8.11.3';
import { simple as walkSimple } from 'https://esm.sh/acorn-walk@8.3.2';
import MagicString from 'https://esm.sh/magic-string@0.30.5';

// Helper: Clean Filename
export const cleanName = (name) => name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

export function uint8ToString(u8) {
  if (typeof u8 === 'string') return u8;
  if (!(u8 instanceof Uint8Array)) return String(u8 ?? '');
  return new TextDecoder().decode(u8);
}

// --- Asset Analyzer & Rewriter (Vite Logic) ---

export class AssetAnalyzer {
    constructor() {
        this.dependencies = {};
    }

    // Detects libraries and converts CDN URLs to NPM package names
    // Returns: Clean import source (e.g., 'three')
    normalizeImport(source) {
        if (!source || typeof source !== 'string') return source;
        if (source.startsWith('.') || source.startsWith('/')) return source;

        // 1. Three.js Handling
        if (source.includes('/three') || source === 'three') {
            this.dependencies['three'] = '^0.160.0';
            
            // Handle Addons (OrbitControls, GLTFLoader, etc.)
            // Detect "examples/jsm" or "addons"
            if (source.includes('examples/jsm') || source.includes('addons') || source.includes('controls')) {
                // Try to extract the path after 'jsm'
                const match = source.match(/(?:examples\/jsm|addons)\/(.+)/);
                if (match) {
                    let suffix = match[1];
                    // Strip query params if any
                    suffix = suffix.split('?')[0];
                    if (!suffix.endsWith('.js')) suffix += '.js';
                    return `three/examples/jsm/${suffix}`;
                }
            }
            return 'three';
        }

        // 2. Tween.js
        if (source.toLowerCase().includes('tween')) {
            this.dependencies['@tweenjs/tween.js'] = '^23.1.0';
            return '@tweenjs/tween.js';
        }

        // 3. Pixi.js
        if (source.toLowerCase().includes('pixi')) {
            this.dependencies['pixi.js'] = '^7.0.0';
            return 'pixi.js';
        }

        // 4. Generic esm.sh / unpkg Handling
        // Capture package name: esm.sh/confetti-js@1.0.0
        const pkgMatch = source.match(/(?:esm\.sh|unpkg\.com|jsdelivr\.net)\/(?:npm\/)?(@?[^@\/?]+)/);
        if (pkgMatch) {
            const pkg = pkgMatch[1];
            // Filter out common non-packages or mistakes
            if (pkg !== 'gh' && pkg !== 'npm') {
                this.dependencies[pkg] = 'latest';
                return pkg;
            }
        }
        
        // Return original if we can't map it (Vite might fail, but best effort)
        return source;
    }

    // Rewrites JS imports to use NPM packages
    processJS(jsContent, filename = 'script.js') {
        const code = uint8ToString(jsContent);
        
        // Calculate relative path to root for asset corrections
        const depth = (filename.match(/\//g) || []).length;
        const rootPrefix = depth > 0 ? '../'.repeat(depth) : './';

        let ast;
        try {
            ast = acorn.parse(code, { sourceType: 'module', ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowHashBang: true });
        } catch (e) {
            console.warn(`[Analyzer] Parse error in ${filename}:`, e.message);
            return code; // Return original if parse fails
        }

        const magic = new MagicString(code);
        let hasChanges = false;

        const rewrite = (node) => {
            if (node.source && node.source.value) {
                const newVal = this.normalizeImport(node.source.value);
                if (newVal !== node.source.value) {
                    magic.overwrite(node.source.start, node.source.end, JSON.stringify(newVal));
                    hasChanges = true;
                }
            }
        };

        const rewritePaths = (node) => {
            if (node.type === 'Literal' && typeof node.value === 'string') {
                const val = node.value;
                // Rewrite absolute paths to static assets
                // e.g. "/assets/sound.mp3" -> "./assets/sound.mp3" (if root) or "../assets/sound.mp3" (if nested)
                if (val.startsWith('/') && !val.startsWith('//') && /\.(png|jpg|jpeg|gif|mp3|wav|ogg|glb|gltf|svg|json)$/i.test(val)) {
                    const newVal = rootPrefix + val.substring(1);
                    magic.overwrite(node.start, node.end, JSON.stringify(newVal));
                    hasChanges = true;
                }
            }
        };

        walkSimple(ast, {
            ImportDeclaration: rewrite,
            ExportNamedDeclaration: rewrite,
            ExportAllDeclaration: rewrite,
            ImportExpression: (node) => { // dynamic import()
                if (node.source.type === 'Literal') {
                    const newVal = this.normalizeImport(node.source.value);
                    if (newVal !== node.source.value) {
                        magic.overwrite(node.source.start, node.source.end, JSON.stringify(newVal));
                        hasChanges = true;
                    }
                }
            },
            Literal: rewritePaths
        });

        // Remove "import { ... } from '...'" where import is a URL that might be purely side-effect or polyfill we don't need? 
        // No, keep them, user intent matters.

        return hasChanges ? magic.toString() : code;
    }

    // Process HTML: Remove import maps, extract inline scripts, inject polyfills
    processHTML(htmlContent, filename) {
        let html = uint8ToString(htmlContent);
        const extractedScripts = [];
        let scriptCounter = 0;

        // Ensure DOCTYPE
        if (!html.trim().toLowerCase().startsWith('<!doctype')) {
            html = '<!DOCTYPE html>\n' + html;
        }

        // 1. Remove Import Maps (Vite handles this)
        html = html.replace(/<script\s+type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi, '<!-- Import Map Removed by Converter -->');

        // 2. Inject Polyfills (Logger, Socket) - Now extracted to separate files in client/
        // We will inject <script src="./logger.js"></script> etc.
        const polyfills = `<script type="module" src="./logger.js"></script>\n    <script type="module" src="./websim_socket.js"></script>`;
        if (html.includes('<head>')) {
            html = html.replace('<head>', '<head>\n    ' + polyfills);
        } else {
            html = polyfills + '\n' + html;
        }

        // 3. Process Scripts
        html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, content) => {
            // Check src
            const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
            if (srcMatch) {
                const src = srcMatch[1];
                // If remote script (http), try to map it? 
                // Vite doesn't like remote scripts in index.html unless ignored.
                // Best practice: Download it or ignore. 
                // For this converter, we'll leave it, but warn?
                // Actually, strict CSP means we should probably leave it and let Devvit block it or user fix it.
                // But better: if it's a library, we might have mapped it? No, script tags are hard to map to npm deps automatically without import map.
                return match; 
            }

            // Inline Script -> Extract to file
            if (!content.trim()) return match;
            
            // Skip JSON/LD
            if (attrs.includes('application/json')) return match;

            scriptCounter++;
            const safeName = filename.replace(/[^\w]/g, '_');
            const newScriptName = `${safeName}_inline_${scriptCounter}.js`;
            
            // Process the content for imports too
            const processedContent = this.processJS(content, newScriptName);
            extractedScripts.push({ filename: newScriptName, content: processedContent });

            // Force type="module" for Vite compatibility usually, or just keep original type?
            // If it has imports, it must be module.
            let newAttrs = attrs;
            if (processedContent.includes('import ') && !newAttrs.includes('type="module"')) {
                newAttrs += ' type="module"';
            }

            return `<script src="./${newScriptName}" ${newAttrs}></script>`;
        });

        // 4. Remove inline event handlers (CSP) - crude regex
        html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

        return { html, extractedScripts };
    }

    processCSS(cssContent, filename = 'style.css') {
        const css = uint8ToString(cssContent);
        
        const depth = (filename.match(/\//g) || []).length;
        const rootPrefix = depth > 0 ? '../'.repeat(depth) : './';

        // Replace absolute paths in url() with relative ones
        // e.g. url(/images/bg.png) -> url(./images/bg.png) or url(../images/bg.png)
        return css.replace(/url\(\s*(['"]?)(\/[^)'"]+)\1\s*\)/gi, (match, quote, path) => {
            if (path.startsWith('//')) return match; // Skip protocol-relative
            return `url(${quote}${rootPrefix}${path.substring(1)}${quote})`;
        });
    }
}

