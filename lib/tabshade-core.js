/**
 * TabShade core logic.
 *
 * Pure, side-effect-free helpers shared by the popup, options page, content
 * script, and background worker. Keeping them here removes duplication (the
 * level-clamping logic used to be copied into three files) and makes the
 * fiddly parts — level clamping, settings parsing, the shade-level precedence,
 * dark-page detection, and the badge decision — unit testable without a
 * browser.
 *
 * The file is a plain (classic) script so it can be listed directly in the
 * manifest and loaded before the scripts that use it; it attaches its API to
 * `globalThis.TabShade`. It also exports the same API via CommonJS so the
 * Vitest suite (running under Node) can import it. No bundler is involved, which
 * keeps the extension's simple no-build packaging intact.
 */
(function (root) {
    "use strict";

    /**
     * The maximum opacity the overlay reaches at 100%. Kept below 1 so a fully
     * shaded page is still faintly visible rather than completely black.
     */
    const MAX_OPACITY = 0.9;

    /**
     * The perceived-luminance threshold (0-255) below which a page background
     * is considered "dark". Around 40% brightness.
     */
    const DARK_LUMINANCE_THRESHOLD = 110;

    /**
     * Badge colours: a medium yellow when the level comes from a saved site,
     * and the default blue-grey otherwise (e.g. a "shade by default" level).
     */
    const SAVED_BADGE_COLOR = "#fdeaaf";
    const DEFAULT_BADGE_COLOR = "#5a5a8f";

    /**
     * Clamp a shade level to the valid 0-100 range and coerce it to a number.
     * Non-numeric or non-finite input becomes 0.
     */
    function normalizeLevel(level) {
        const n = Number(level);
        if (!Number.isFinite(n)) {
            return 0;
        }
        return Math.max(0, Math.min(100, Math.round(n)));
    }

    /**
     * Parse a raw stored settings object into a normalised shape with defaults
     * filled in. Unknown/missing fields fall back to safe defaults.
     */
    function normalizeSettings(stored) {
        return {
            shadeByDefault: !!(stored && stored.shadeByDefault),
            defaultLevel: normalizeLevel(stored && stored.defaultLevel),
            skipDarkSites: !!(stored && stored.skipDarkSites),
            theme: stored && stored.theme === "dark" ? "dark" : "light",
        };
    }

    /**
     * Decide the shade level a page should use, given plain inputs (no storage
     * or DOM access). Precedence:
     *   1. An explicitly saved level for the domain wins.
     *   2. Otherwise, when "shade by default" is on, the default level — unless
     *      the page is already dark and the user opted to skip dark sites.
     *   3. Otherwise, no shading.
     *
     * @param {object} input
     * @param {boolean} input.isSaved      Whether the domain has a saved level.
     * @param {number}  input.savedLevel   The saved level (if isSaved).
     * @param {boolean} input.shadeByDefault
     * @param {number}  input.defaultLevel
     * @param {boolean} input.skipDarkSites
     * @param {boolean} input.isDark       Whether the page reads as dark.
     * @returns {number} The resolved shade level (0-100).
     */
    function resolveLevel(input) {
        const opts = input || {};
        if (opts.isSaved) {
            return normalizeLevel(opts.savedLevel);
        }
        if (opts.shadeByDefault) {
            if (opts.skipDarkSites && opts.isDark) {
                return 0;
            }
            return normalizeLevel(opts.defaultLevel);
        }
        return 0;
    }

    /**
     * Perceived luminance (0-255) of an RGB colour, weighted for human vision.
     */
    function luminance(r, g, b) {
        return 0.299 * r + 0.587 * g + 0.114 * b;
    }

    /**
     * Whether an RGB background colour counts as "dark".
     */
    function isDarkColor(r, g, b) {
        return luminance(r, g, b) < DARK_LUMINANCE_THRESHOLD;
    }

    /**
     * Convert a shade level (0-100) to the overlay's rgba() background colour,
     * or an empty string when there is no shading.
     */
    function overlayColorForLevel(level) {
        const normalized = normalizeLevel(level);
        if (normalized <= 0) {
            return "";
        }
        const opacity = (normalized / 100) * MAX_OPACITY;
        return `rgba(0, 0, 0, ${opacity})`;
    }

    /**
     * Recover the shade level (0-100) from an overlay's rgba() background
     * colour string, or 0 if it can't be parsed.
     */
    function levelFromOverlayColor(color) {
        if (!color) {
            return 0;
        }
        const match = color.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/);
        if (!match) {
            return 0;
        }
        const opacity = parseFloat(match[1]);
        return Math.round((opacity / MAX_OPACITY) * 100);
    }

    /**
     * Parse a CSS colour string (as returned by getComputedStyle, e.g.
     * "rgb(20, 20, 20)" or "rgba(0, 0, 0, 0.5)") into {r, g, b, a}, or null if
     * it can't be understood.
     */
    function parseColor(color) {
        if (!color) {
            return null;
        }
        const match = color.match(
            /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i
        );
        if (!match) {
            return null;
        }
        return {
            r: parseFloat(match[1]),
            g: parseFloat(match[2]),
            b: parseFloat(match[3]),
            a: match[4] !== undefined ? parseFloat(match[4]) : 1,
        };
    }

    /**
     * Decide the toolbar badge text and background colour for a shade level.
     * A level of 0 clears the badge (empty text). Saved sites get the yellow
     * colour; everything else the default blue-grey.
     */
    function badgeForLevel(level, saved) {
        const normalized = normalizeLevel(level);
        return {
            text: normalized > 0 ? `${normalized}` : "",
            color: saved ? SAVED_BADGE_COLOR : DEFAULT_BADGE_COLOR,
        };
    }

    const api = {
        MAX_OPACITY,
        DARK_LUMINANCE_THRESHOLD,
        SAVED_BADGE_COLOR,
        DEFAULT_BADGE_COLOR,
        normalizeLevel,
        normalizeSettings,
        resolveLevel,
        luminance,
        isDarkColor,
        overlayColorForLevel,
        levelFromOverlayColor,
        parseColor,
        badgeForLevel,
    };

    // Browser (classic script): expose on a global namespace for the other
    // extension scripts loaded after this one.
    root.TabShade = Object.assign(root.TabShade || {}, api);

    // Node / Vitest: expose via CommonJS for the test suite.
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
