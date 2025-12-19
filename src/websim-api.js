// WebSim API Integration
// Re-using the logic provided in the prompt, structured as an ES Module

const API_BASE = '/api/v1';

async function makeRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    
    return response.json();
}

export function getProjectById(projectId) {
    return makeRequest(`/projects/${projectId}`);
}

export function getProjectBySlug(username, slug) {
    return makeRequest(`/users/${username}/slugs/${slug}`);
}

export function getProjectRevisions(projectId, params = {}) {
    const query = new URLSearchParams(params).toString();
    return makeRequest(`/projects/${projectId}/revisions?${query}`);
}

export async function getAllProjectRevisions(projectId) {
    let allRevisions = [];
    let hasNextPage = true;
    let afterCursor = null;

    // Safety limit to prevent infinite loops on massive histories
    let pageCount = 0;
    const MAX_PAGES = 10;

    while (hasNextPage && pageCount < MAX_PAGES) {
        const params = { first: 50 };
        if (afterCursor) {
            params.after = afterCursor;
        }

        try {
            const response = await getProjectRevisions(projectId, params);
            if (response.revisions && response.revisions.data) {
                allRevisions = allRevisions.concat(response.revisions.data);
            }
            
            hasNextPage = response.revisions?.meta?.has_next_page || false;
            afterCursor = response.revisions?.meta?.end_cursor;
            
            if (!afterCursor) hasNextPage = false;
        } catch (e) {
            console.warn("Error fetching revision page", e);
            hasNextPage = false;
        }
        pageCount++;
    }

    return allRevisions;
}

export function getAssets(projectId, version) {
    return makeRequest(`/projects/${projectId}/revisions/${version}/assets`);
}

export function parseProjectIdentifier(input) {
    if (!input) return null;
    
    try {
        const url = new URL(input.startsWith('http') ? input : `https://${input}`);
        const pathname = url.pathname;

        const projectMatch = pathname.match(/^\/p\/([a-z0-9_-]{20})/);
        if (projectMatch) return { type: 'id', value: projectMatch[1] };

        const slugMatch = pathname.match(/^\/(@[^/]+)\/([^/]+)/);
        if (slugMatch) return { type: 'slug', username: slugMatch[1].substring(1), slug: slugMatch[2] };
        
        const cMatch = pathname.match(/^\/c\/([a-z0-9_-]{20})/);
        if (cMatch) return { type: 'id', value: cMatch[1] };

    } catch (e) { /* Not a URL */ }

    const atSlugMatch = input.match(/^@([^/]+)\/([^/]+)/);
    if (atSlugMatch) return { type: 'slug', username: atSlugMatch[1], slug: atSlugMatch[2] };

    const slugMatch = input.match(/^([a-zA-Z0-9_]{3,32})\/([a-zA-Z0-9-]{3,50})$/);
    if (slugMatch) return { type: 'slug', username: slugMatch[1], slug: slugMatch[2] };

    if (/^[a-z0-9_-]{20}$/.test(input)) return { type: 'id', value: input };

    throw new Error(`Invalid project identifier: "${input}".`);
}

export async function fetchProjectMetadata(identifier) {
    if (identifier.type === 'id') {
        return getProjectById(identifier.value);
    } else {
        return getProjectBySlug(identifier.username, identifier.slug);
    }
}

export async function processAssets(assetList) {
    const files = {};
    const encoder = new TextEncoder();

    if (!assetList || !Array.isArray(assetList)) {
        return files;
    }

    const promises = assetList.map(async (asset) => {
        if (!asset.path) return;
        
        const path = asset.path.replace(/^(\.|\/)+/, ''); // Clean path
        if (path.endsWith('/')) return; // Skip explicitly marked directories

        // Skip items that have neither content nor URL (likely directories in API response)
        if (asset.content === undefined && !asset.url) return;

        if (typeof asset.content === 'string') {
            files[path] = encoder.encode(asset.content);
            return;
        }
        
        if (!asset.content && asset.url) {
            try {
                // Handle relative URLs by resolving against current origin
                const fetchUrl = new URL(asset.url, window.location.origin).href;
                const res = await fetch(fetchUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                // Check content type to prevent saving HTML error pages as binary assets
                // This prevents "EncodingError" in AudioContext when the game tries to decode an error page
                const contentType = res.headers.get('content-type');
                if (contentType && contentType.includes('text/html') && /\.(mp3|wav|ogg|glb|gltf|png|jpg|jpeg|gif)$/i.test(path)) {
                    throw new Error(`Received HTML (likely error page) instead of binary for ${path}`);
                }

                const blob = await res.arrayBuffer();
                files[path] = new Uint8Array(blob);
            } catch (e) {
                console.warn(`[Asset Warning] Skipping ${path}:`, e.message);
                // We do NOT write a placeholder file here. 
                // A missing file (404) is handled better by game engines than a corrupted file (EncodingError).
            }
            return;
        }

        if (asset.content && typeof asset.content === 'object') {
            files[path] = encoder.encode(JSON.stringify(asset.content));
            return;
        }

        // If we got here, we have a weird asset type, skip or mark empty
        // But to avoid validation errors, let's skip if it's truly empty/unknown
        if (!asset.content && !asset.url) return;

        files[path] = new Uint8Array(0);
    });

    await Promise.all(promises);
    return files;
}

