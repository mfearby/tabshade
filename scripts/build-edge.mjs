#!/usr/bin/env node
/**
 * Build a Microsoft Edge-compatible package from the shared (Firefox-native) source.
 *
 * Edge is Chromium-based and needs the same three things as the Chrome build:
 *   1. The webextension-polyfill, so `browser.*` works on top of `chrome.*`.
 *   2. A Manifest V3 service-worker background (manifest.edge.json).
 *   3. Edge-appropriate wording for the "rebind shortcuts" hint, pointing to
 *      edge://extensions/shortcuts instead of chrome://extensions/shortcuts.
 *
 * This script assembles those differences into dist/edge without touching
 * the shared source, then zips the result for the Microsoft Edge Add-ons store.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", "edge");
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
 * Source files/dirs to copy into the Edge build. The manifest is handled
 * separately (manifest.edge.json is renamed to manifest.json), and dev-only
 * files are simply not listed here.
 */
const SOURCE_ENTRIES = [
    "background",
    "content_scripts",
    "icons",
    "lib",
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
 * Read the version from the Edge manifest.
 */
async function readVersion() {
    const manifest = JSON.parse(
        await fs.readFile(path.join(root, "manifest.edge.json"), "utf8")
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

    // 3. Edge manifest becomes manifest.json in the package.
    await fs.copyFile(
        path.join(root, "manifest.edge.json"),
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

    // 6. The service worker must load the polyfill (provides `browser`) and the
    //    shared core (provides the TabShade global) before its own code runs.
    //    importScripts resolves relative to the extension root, so absolute
    //    paths are safest. The polyfill comes first so `browser` is available;
    //    the core is independent but loaded here too since background.js reads
    //    globalThis.TabShade at the top level.
    const bgFile = path.join(distDir, "background", "background.js");
    const bgSource = await fs.readFile(bgFile, "utf8");
    await fs.writeFile(
        bgFile,
        `importScripts("/${POLYFILL_NAME}", "/lib/tabshade-core.js");\n\n${bgSource}`,
        "utf8"
    );

    // 7. Edge shortcuts are not enabled by default, so remove the key-binding
    //    hint lines from the footer — they'd be misleading until the user
    //    manually enables them. The rebind link (step 8) stays so they can
    //    enable the shortcuts if they want them.
    await replaceInFile(
        path.join(distDir, "popup", "popup.html"),
        `<div>Alt+Shift+↑ more dim · Alt+Shift+↓ less dim</div>
            <div>Alt+Shift+D toggle</div>
            <div id="shortcut-rebind">`,
        `<div id="shortcut-rebind">`
    );

    // 8. Edge can open edge://extensions/shortcuts via tabs.create, so turn
    //    the plain-text Firefox hint into a clickable link (popup.js wires up
    //    #shortcut-link when it is present).
    await replaceInFile(
        path.join(distDir, "popup", "popup.html"),
        `Rebind in about:addons → ⚙ → Manage Extension Shortcuts`,
        `Rebind at
                <a
                    href="#"
                    id="shortcut-link"
                    data-url="edge://extensions/shortcuts"
                    >edge://extensions/shortcuts</a
                >`
    );

    // 8. Zip the package. Use the platform `zip` tool, zipping the dist
    //    contents (not the dist folder itself) so the manifest sits at the root.
    await fs.mkdir(artifactsDir, { recursive: true });
    const version = await readVersion();
    const zipPath = path.join(artifactsDir, `tabshade-edge-${version}.zip`);
    await fs.rm(zipPath, { force: true });
    execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: distDir });

    console.log(`Edge package ready: ${path.relative(root, zipPath)}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
