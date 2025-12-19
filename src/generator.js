import JSZip from 'jszip';
import { 
    cleanName, 
    AssetAnalyzer 
} from './processors.js';

import {
    generatePackageJson,
    generateDevvitYaml,
    generateViteConfig,
    tsConfig,
    getMainTsx,
    simpleLoggerJs,
    websimSocketPolyfill,
    validateScript,
    setupScript,
    generateReadme
} from './templates.js';

export async function generateDevvitZip(projectMeta, assets, includeReadme = true) {
    const zip = new JSZip();
    
    const safeId = projectMeta.project.id ? projectMeta.project.id.slice(0, 6) : '000000';
    const rawSlug = projectMeta.project.slug || "websim-game";
    const projectSlug = cleanName(`${rawSlug}-${safeId}`);
    const projectTitle = projectMeta.project.title || "WebSim Game";

    // Initialize Analyzer
    const analyzer = new AssetAnalyzer();
    const clientFiles = {};

    // 1. Process Assets for Client Folder
    // We categorize files: JS gets rewritten, HTML gets cleaned, rest copied.
    
    for (const [path, content] of Object.entries(assets)) {
        if (path.includes('..')) continue;

        if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.ts')) {
            const processed = analyzer.processJS(content, path);
            clientFiles[path] = processed;
        } else if (path.endsWith('.html')) {
            const { html, extractedScripts } = analyzer.processHTML(content, path.split('/').pop());
            clientFiles[path] = html;
            
            // Add extracted inline scripts to client files
            extractedScripts.forEach(script => {
                // Place them relative to the html file
                const parts = path.split('/');
                parts.pop();
                const dir = parts.join('/');
                const fullPath = dir ? `${dir}/${script.filename}` : script.filename;
                clientFiles[fullPath] = script.content;
            });
        } else {
            // Static assets (images, css, etc)
            clientFiles[path] = content;
        }
    }

    // Identify Index for Devvit Main.tsx
    let indexPath = 'index.html'; 
    for (const p of Object.keys(clientFiles)) {
        if (p.endsWith('index.html')) {
            indexPath = p;
            break; 
        }
    }

    // 2. Generate Config Files
    // Now that we've analyzed files, analyzer.dependencies is populated
    zip.file("package.json", generatePackageJson(projectSlug, analyzer.dependencies));
    zip.file("devvit.yaml", generateDevvitYaml(projectSlug));
    zip.file("vite.config.js", generateViteConfig());
    zip.file("tsconfig.json", tsConfig);
    zip.file(".gitignore", "node_modules\n.devvit\nwebroot/assets"); // Ignore build artifacts if needed

    if (includeReadme) {
        zip.file("README.md", generateReadme(projectTitle, `https://websim.ai/p/${projectMeta.project.id}`));
    }

    zip.file("scripts/setup.js", setupScript);
    zip.file("scripts/validate.js", validateScript);

    // 3. Client Folder (Source)
    const clientFolder = zip.folder("client");
    for (const [path, content] of Object.entries(clientFiles)) {
        clientFolder.file(path, content);
    }

    // Add Polyfills to Client
    clientFolder.file("logger.js", simpleLoggerJs);
    clientFolder.file("websim_socket.js", websimSocketPolyfill);

    // 4. Source Code (Devvit Main.tsx)
    zip.file("src/main.tsx", getMainTsx(projectTitle, indexPath));

    // Note: 'webroot' folder is not created here, it will be created by 'npm run build:client' inside the user's project.
    
    const blob = await zip.generateAsync({ type: "blob" });
    return { blob, filename: `${projectSlug}-devvit.zip` };
}

