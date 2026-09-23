(function () {
    /**
     * Check and set a global guard variable to ensure that if this content
     * script is injected into a page again, it returns (and does nothing).
     */
    if (window.hasRun) {
        return;
    }
    window.hasRun = true;

    const OVERLAY_ID = "tabshade-overlay";

    /**
     * Storage keys. `shadedDomains` holds only the sites the user has
     * explicitly chosen to save (domain -> level). `settings` holds the global
     * "shade by default" preference and its level.
     */
    const STORAGE_KEY = "shadedDomains";
    const SETTINGS_KEY = "settings";

    /**
     * The maximum opacity the overlay reaches at 100%. Kept below 1 so a fully
     * shaded page is still faintly visible rather than completely black.
     */
    const MAX_OPACITY = 0.9;

    /**
     * How much the keyboard shortcuts change the shade level per press.
     */
    const STEP = 5;

    /**
     * The level used when toggling shading on for a page that has no saved or
     * default level to fall back to.
     */
    const FALLBACK_LEVEL = 20;

    /**
     * Get the current page's domain (hostname). Returns null for pages that
     * don't have a meaningful hostname (e.g. about: pages).
     */
    function getDomain() {
        return window.location.hostname || null;
    }

    /**
     * Clamp a shade level to the valid 0-100 range and coerce it to a number.
     */
    function normalizeLevel(level) {
        const n = Number(level);
        if (!Number.isFinite(n)) {
            return 0;
        }
        return Math.max(0, Math.min(100, Math.round(n)));
    }

    /**
     * Read the map of saved domains (domain -> shade level) from local storage.
     * Only contains sites the user explicitly chose to save.
     */
    async function getShadedDomains() {
        const result = await browser.storage.local.get(STORAGE_KEY);
        const stored = result[STORAGE_KEY];
        return stored && typeof stored === "object" ? stored : {};
    }

    /**
     * Read the global settings: whether to shade by default and at what level.
     */
    async function getSettings() {
        const result = await browser.storage.local.get(SETTINGS_KEY);
        const stored = result[SETTINGS_KEY];
        return {
            shadeByDefault: !!(stored && stored.shadeByDefault),
            defaultLevel: normalizeLevel(stored && stored.defaultLevel),
            skipDarkSites: !!(stored && stored.skipDarkSites),
        };
    }

    /**
     * Parse a CSS color string (as returned by getComputedStyle, e.g.
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
     * Find the effective background colour of the page by checking <body> then
     * <html>, skipping fully transparent backgrounds. Falls back to white,
     * which is what a browser renders when no background is set.
     */
    function getPageBackgroundColor() {
        const candidates = [document.body, document.documentElement];
        for (const el of candidates) {
            if (!el) {
                continue;
            }
            const color = parseColor(getComputedStyle(el).backgroundColor);
            if (color && color.a > 0) {
                return color;
            }
        }
        return { r: 255, g: 255, b: 255, a: 1 };
    }

    /**
     * The perceived-luminance threshold (0-255) below which a page background
     * is considered "dark". Around 40% brightness.
     */
    const DARK_LUMINANCE_THRESHOLD = 110;

    /**
     * Decide whether the current page already uses a dark background, using the
     * standard perceived-luminance formula weighted for human vision.
     */
    function isPageDark() {
        const { r, g, b } = getPageBackgroundColor();
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        return luminance < DARK_LUMINANCE_THRESHOLD;
    }

    /**
     * Whether the current domain has an explicitly saved shade level.
     */
    async function isDomainSaved(domain) {
        if (!domain) {
            return false;
        }
        const domains = await getShadedDomains();
        return Object.prototype.hasOwnProperty.call(domains, domain);
    }

    /**
     * Read the saved shade level for the given domain, or 0 if it isn't saved.
     */
    async function getSavedLevel(domain) {
        if (!domain) {
            return 0;
        }
        const domains = await getShadedDomains();
        return normalizeLevel(domains[domain]);
    }

    /**
     * Save a shade level for the current domain in local storage so it appears
     * in the preferences screen and is applied automatically on future visits.
     */
    async function saveDomain(domain, level) {
        if (!domain) {
            return;
        }
        const domains = await getShadedDomains();
        domains[domain] = normalizeLevel(level);
        await browser.storage.local.set({ [STORAGE_KEY]: domains });
    }

    /**
     * Remove the current domain from the saved list. The page falls back to the
     * "shade by default" behaviour (or no shading) afterwards.
     */
    async function unsaveDomain(domain) {
        if (!domain) {
            return;
        }
        const domains = await getShadedDomains();
        if (Object.prototype.hasOwnProperty.call(domains, domain)) {
            delete domains[domain];
            await browser.storage.local.set({ [STORAGE_KEY]: domains });
        }
    }

    /**
     * Apply the given shade level to the page. A level of 0 removes the
     * overlay; any higher level creates or updates it with a matching opacity.
     * This only changes what is shown; it does not touch storage.
     */
    function applyLevel(level) {
        const normalized = normalizeLevel(level);
        let overlay = document.getElementById(OVERLAY_ID);

        if (normalized <= 0) {
            if (overlay) {
                overlay.remove();
            }
            notifyLevelChanged(0);
            return;
        }

        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = OVERLAY_ID;
            overlay.style.position = "fixed";
            overlay.style.top = "0";
            overlay.style.left = "0";
            overlay.style.width = "100%";
            overlay.style.height = "100%";
            overlay.style.pointerEvents = "none";
            overlay.style.zIndex = "2147483647";
            document.body.appendChild(overlay);
        }

        const opacity = (normalized / 100) * MAX_OPACITY;
        overlay.style.backgroundColor = `rgba(0, 0, 0, ${opacity})`;
        notifyLevelChanged(normalized);
    }

    /**
     * Notify the background script that this tab's shade level changed, so it
     * can update the badge shown on the toolbar icon. Includes whether this
     * domain is saved, so the badge can be coloured differently.
     */
    async function notifyLevelChanged(level) {
        try {
            await browser.runtime.sendMessage({
                command: "levelChanged",
                level: normalizeLevel(level),
                saved: await isDomainSaved(getDomain()),
            });
        } catch (error) {
            // No receiver (e.g. background not ready); safe to ignore.
        }
    }

    /**
     * Change the current shade level, and if this domain is saved, persist the
     * new level too. Used by both the popup slider and keyboard shortcuts.
     */
    async function changeLevel(level) {
        const normalized = normalizeLevel(level);
        applyLevel(normalized);
        const domain = getDomain();
        if (await isDomainSaved(domain)) {
            await saveDomain(domain, normalized);
        }
    }

    /**
     * Change the current shade level by the given delta (positive to dim more,
     * negative to dim less), clamped to the valid range.
     */
    async function adjustLevel(delta) {
        await changeLevel(getCurrentLevel() + Number(delta));
    }

    /**
     * Toggle shading on the current page. If shaded, turn it off; otherwise
     * apply the saved level, the default level, or a fallback, in that order.
     */
    async function toggleShade() {
        if (getCurrentLevel() > 0) {
            await changeLevel(0);
            return;
        }
        const domain = getDomain();
        const saved = await getSavedLevel(domain);
        if (saved > 0) {
            await changeLevel(saved);
            return;
        }
        const settings = await getSettings();
        const fallback =
            settings.shadeByDefault && settings.defaultLevel > 0
                ? settings.defaultLevel
                : FALLBACK_LEVEL;
        await changeLevel(fallback);
    }

    /**
     * Determine the level that should be applied to this page on load: a saved
     * per-domain level takes precedence, otherwise the global default when
     * "shade by default" is enabled, otherwise no shading.
     */
    async function resolveInitialLevel() {
        const domain = getDomain();
        if (await isDomainSaved(domain)) {
            return getSavedLevel(domain);
        }
        const settings = await getSettings();
        if (settings.shadeByDefault) {
            // Leave already-dark pages alone when the user has opted to skip
            // them. This only affects the automatic default; explicitly saved
            // sites and manual adjustments are unaffected.
            if (settings.skipDarkSites && isPageDark()) {
                return 0;
            }
            return settings.defaultLevel;
        }
        return 0;
    }

    /**
     * On load, apply the resolved level for this page and report it for the
     * toolbar badge.
     */
    async function applyOnLoad() {
        applyLevel(await resolveInitialLevel());
    }

    /**
     * Listen for messages from the popup.
     */
    browser.runtime.onMessage.addListener((message) => {
        if (message.command === "changeLevel") {
            changeLevel(message.level);
        } else if (message.command === "adjustLevel") {
            adjustLevel(message.delta);
        } else if (message.command === "toggleShade") {
            toggleShade();
        } else if (message.command === "saveSite") {
            applyLevel(message.level);
            saveDomain(getDomain(), message.level);
        } else if (message.command === "unsaveSite") {
            unsaveDomain(getDomain());
        } else if (message.command === "getState") {
            return getState();
        }
    });

    /**
     * Build a snapshot of the current tab's state for the popup: the level
     * currently applied, whether this domain is saved, and its saved level.
     */
    async function getState() {
        const domain = getDomain();
        const saved = await isDomainSaved(domain);
        return {
            level: normalizeLevel(getCurrentLevel()),
            domain,
            saved,
            savedLevel: saved ? await getSavedLevel(domain) : 0,
            isDark: isPageDark(),
        };
    }

    /**
     * React to changes made elsewhere (the preferences page, or settings
     * changing) by re-resolving and re-applying this page's level.
     */
    browser.storage.onChanged.addListener(async (changes, area) => {
        if (area !== "local" || (!changes[STORAGE_KEY] && !changes[SETTINGS_KEY])) {
            return;
        }
        const resolved = await resolveInitialLevel();
        if (resolved !== getCurrentLevel()) {
            applyLevel(resolved);
        }
    });

    /**
     * Determine the level currently applied to the page based on the overlay's
     * opacity, or 0 if there is no overlay.
     */
    function getCurrentLevel() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) {
            return 0;
        }
        const match = overlay.style.backgroundColor.match(
            /rgba?\([^)]*,\s*([\d.]+)\s*\)/
        );
        if (!match) {
            return 0;
        }
        const opacity = parseFloat(match[1]);
        return Math.round((opacity / MAX_OPACITY) * 100);
    }

    applyOnLoad();
})();
