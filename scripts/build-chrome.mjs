#!/usr/bin/env node
/**
 * Build a Chrome-compatible package from the shared (Firefox-native) source.
 *
 * The source tree targets Firefox and uses the native, promise-based `browser`
 * API with a persistent background script. Chrome needs three things the
 * Firefox source doesn't ship:
 *   1. The webextension-polyfill, so `browser.*` works on top of `chrome.*`.
 *   2. A Manifest V3 service-worker background (manifest.chrome.json).
 *   3. Chrome-appropriate wording for the "rebind shortcuts" hint.
 *
 * This script assembles those differences into dist/chrome without touching
 * the shared source, then zips the result for the Chrome Web Store.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", "chrome");
const artifactsDir = path.join(root, "web-ext-artifacts");

const POLYFILL_SRC = path.join(
    root,
    "node_modules",
    "webextension-polyfill",
    "dist",
    "browser-polyfill.min.js"
);
const POLYFILL_NAME = "browser-polyfill.min.js";

/**
 * Source files/dirs to copy into the Chrome build. The manifest is handled
 * separately (manifest.chrome.json is renamed to manifest.json), and dev-only
 * files are simply not listed here.
 */
const SOURCE_ENTRIES = [
    "background",
    "content_scripts",
    "icons",
    "options",
    "popup",
];

/**
 * Recursively copy a file or directory, skipping .DS_Store noise.
 */
async function copyEntry(src, dest) {
    const stat = await fs.stat(src);
    if (stat.isDirectory()) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src);
        for (const entry of entries) {
            if (entry === ".DS_Store") {
                continue;
            }
            await copyEntry(path.join(src, entry), path.join(dest, entry));
        }
    } else {
        await fs.copyFile(src, dest);
    }
}

/**
 * Replace all occurrences of `find` in a file with `replacement`. Throws if the
 * text isn't found, so a source change that breaks an assumption fails loudly
 * rather than silently producing a broken build.
 */
async function replaceInFile(file, find, replacement) {
    const original = await fs.readFile(file, "utf8");
    if (!original.includes(find)) {
        throw new Error(
            `Expected to find ${JSON.stringify(find)} in ${path.relative(
                root,
                file
            )} but it was not present.`
        );
    }
    await fs.writeFile(file, original.split(find).join(replacement), "utf8");
}

/**
 * Read the version from the source manifest so the artifact name matches.
 */
async function readVersion() {
    const manifest = JSON.parse(
        await fs.readFile(path.join(root, "manifest.json"), "utf8")
    );
    return manifest.version;
}

async function main() {
    // 1. Fresh dist dir.
    await fs.rm(distDir, { recursive: true, force: true });
    await fs.mkdir(distDir, { recursive: true });

    // 2. Copy shared source.
    for (const entry of SOURCE_ENTRIES) {
        await copyEntry(path.join(root, entry), path.join(distDir, entry));
    }

    // 3. Chrome manifest becomes manifest.json in the package.
    await fs.copyFile(
        path.join(root, "manifest.chrome.json"),
        path.join(distDir, "manifest.json")
    );

    // 4. Drop the polyfill at the package root.
    await fs.copyFile(POLYFILL_SRC, path.join(distDir, POLYFILL_NAME));

    // 5. Inject the polyfill <script> before each page's own script. The pages
    //    live one level down, so the polyfill is one directory up.
    await replaceInFile(
        path.join(distDir, "popup", "popup.html"),
        '<script src="popup.js"></script>',
        `<script src="../${POLYFILL_NAME}"></script>\n        <script src="popup.js"></script>`
    );
    await replaceInFile(
        path.join(distDir, "options", "options.html"),
        '<script src="options.js"></script>',
        `<script src="../${POLYFILL_NAME}"></script>\n        <script src="options.js"></script>`
    );

    // 6. The service worker must load the polyfill before it runs. importScripts
    //    resolves relative to the extension root, so an absolute path is safest.
    const bgFile = path.join(distDir, "background", "background.js");
    const bgSource = await fs.readFile(bgFile, "utf8");
    await fs.writeFile(
        bgFile,
        `importScripts("/${POLYFILL_NAME}");\n\n${bgSource}`,
        "utf8"
    );

    // 7. Chrome can open chrome://extensions/shortcuts via tabs.create, so turn
    //    the plain-text Firefox hint into a clickable link (popup.js wires up
    //    #shortcut-link when it is present). Firefox keeps the plain text
    //    because it cannot open about:addons programmatically.
    await replaceInFile(
        path.join(distDir, "popup", "popup.html"),
        `<div id="shortcut-rebind">
                Rebind in about:addons → ⚙ → Manage Extension Shortcuts
            </div>`,
        `<div id="shortcut-rebind">
                Rebind at
                <a
                    href="#"
                    id="shortcut-link"
                    data-url="chrome://extensions/shortcuts"
                    >chrome://extensions/shortcuts</a
                >
            </div>`
    );

    // 8. Zip the package. Use the platform `zip` tool, zipping the dist
    //    contents (not the dist folder itself) so the manifest sits at the root.
    await fs.mkdir(artifactsDir, { recursive: true });
    const version = await readVersion();
    const zipPath = path.join(artifactsDir, `tabshade-chrome-${version}.zip`);
    await fs.rm(zipPath, { force: true });
    execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: distDir });

    console.log(`Chrome package ready: ${path.relative(root, zipPath)}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
