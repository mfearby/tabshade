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
     * How much the keyboard shortcuts change the shade level per press.
     */
    const STEP = 5;

    /**
     * The level used when toggling shading on for a page that has no saved or
     * default level to fall back to.
     */
    const FALLBACK_LEVEL = 20;

    // Shared pure helpers (see lib/tabshade-core.js), loaded as a classic
    // script before this one and exposed on the TabShade global.
    const {
        normalizeLevel,
        normalizeSettings,
        resolveLevel,
        resolveSavedEntry,
        parseColor,
        isDarkColor,
        overlayColorForLevel,
        levelFromOverlayColor,
    } = globalThis.TabShade;

    /**
     * Get the current page's domain (hostname). Returns null for pages that
     * don't have a meaningful hostname (e.g. about: pages).
     */
    function getDomain() {
        return window.location.hostname || null;
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
        return normalizeSettings(result[SETTINGS_KEY]);
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
     * Decide whether the current page already uses a dark background.
     */
    function isPageDark() {
        const { r, g, b } = getPageBackgroundColor();
        return isDarkColor(r, g, b);
    }

    /**
     * Resolve the saved entry (if any) that applies to the given domain,
     * matching exact hostnames first and then wildcard patterns such as
     * "*whatever*" or "*.amazon.com". Returns { matchedKey, level } or null.
     *
     * matchedKey is the storage key that matched — possibly a pattern — and is
     * what level edits should be written back to, so adjusting the slider on
     * "whatever.corp.net" updates the "*whatever*" entry rather than creating a
     * new literal entry for that one host.
     */
    async function resolveEntryForDomain(domain) {
        if (!domain) {
            return null;
        }
        const domains = await getShadedDomains();
        return resolveSavedEntry(domain, domains);
    }

    /**
     * Whether the current domain is covered by a saved entry (exact or
     * wildcard).
     */
    async function isDomainSaved(domain) {
        return (await resolveEntryForDomain(domain)) !== null;
    }

    /**
     * Read the effective saved shade level for the given domain (via exact or
     * wildcard match), or 0 if nothing matches.
     */
    async function getSavedLevel(domain) {
        const entry = await resolveEntryForDomain(domain);
        return entry ? normalizeLevel(entry.level) : 0;
    }

    /**
     * Save a shade level under a specific storage key (which may be a wildcard
     * pattern) in local storage so it appears in the preferences screen and is
     * applied automatically on future visits.
     */
    async function saveEntry(key, level) {
        if (!key) {
            return;
        }
        const domains = await getShadedDomains();
        domains[key] = normalizeLevel(level);
        await browser.storage.local.set({ [STORAGE_KEY]: domains });
    }

    /**
     * Remove the saved entry (exact or matched pattern) that applies to the
     * given domain. The page falls back to the "shade by default" behaviour (or
     * no shading) afterwards.
     */
    async function unsaveDomain(domain) {
        if (!domain) {
            return;
        }
        const entry = await resolveEntryForDomain(domain);
        if (!entry) {
            return;
        }
        const domains = await getShadedDomains();
        if (Object.prototype.hasOwnProperty.call(domains, entry.matchedKey)) {
            delete domains[entry.matchedKey];
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

        overlay.style.backgroundColor = overlayColorForLevel(normalized);
        notifyLevelChanged(normalized);
    }

    /**
     * Notify the background script that this tab's shade level changed, so it
     * can update the badge shown on the toolbar icon. Includes whether this
     * domain is saved, so the badge can be coloured differently.
     *
     * Skips the notification while the document is being prerendered by Chrome:
     * a prerendered page is a hidden, not-yet-active document, and letting it
     * report its level would overwrite the badge of the tab the user is
     * actually looking at. When the prerender is activated the page re-notifies
     * as a normal visible document (see the prerenderingchange handler).
     */
    async function notifyLevelChanged(level) {
        if (document.prerendering === true) {
            return;
        }
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
     * Change the current shade level, and if this domain is covered by a saved
     * entry, persist the new level to that same entry. When the match came from
     * a wildcard pattern (e.g. "*whatever*"), the level is written back to the
     * pattern key, not the current hostname — so one pattern stays a single
     * entry instead of spawning a literal copy per host visited.
     */
    async function changeLevel(level) {
        const normalized = normalizeLevel(level);
        applyLevel(normalized);
        const domain = getDomain();
        const entry = await resolveEntryForDomain(domain);
        if (entry) {
            await saveEntry(entry.matchedKey, normalized);
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
     * Save the given level for the current domain, then apply it. Storage is
     * written first so the badge notification (fired from applyLevel) sees the
     * domain as saved and colours the badge accordingly.
     *
     * If the domain is already covered by a saved entry — including a wildcard
     * pattern such as "*.microsoft.com" — the level is written back to that
     * same entry's key, so adjusting the popup slider on "support.microsoft.com"
     * updates the pattern rather than spawning a new literal entry. Only when
     * no entry matches do we create a literal entry for the current hostname.
     */
    async function saveSite(level) {
        const domain = getDomain();
        const entry = await resolveEntryForDomain(domain);
        const key = entry ? entry.matchedKey : domain;
        await saveEntry(key, level);
        applyLevel(level);
    }

    /**
     * Remove the current domain from the saved list, then re-notify so the
     * badge reverts to the default (unsaved) colour. The applied level is left
     * as-is for this tab; it simply is no longer persisted.
     */
    async function unsaveSite() {
        await unsaveDomain(getDomain());
        notifyLevelChanged(getCurrentLevel());
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
        const isSaved = await isDomainSaved(domain);
        const settings = await getSettings();
        return resolveLevel({
            isSaved,
            savedLevel: isSaved ? await getSavedLevel(domain) : 0,
            shadeByDefault: settings.shadeByDefault,
            defaultLevel: settings.defaultLevel,
            skipDarkSites: settings.skipDarkSites,
            isDark: isPageDark(),
        });
    }

    /**
     * On load, apply the resolved level for this page and report it for the
     * toolbar badge.
     */
    async function applyOnLoad() {
        applyLevel(await resolveInitialLevel());
    }

    /**
     * When a prerendered document is activated (the user navigates to a page
     * Chrome preloaded in the background), notifyLevelChanged was suppressed
     * during prerendering, so the badge still reflects the previous page. Fire
     * a fresh notification now that this document is the visible, active tab so
     * the badge catches up without needing a manual tab switch.
     */
    if (document.prerendering === true) {
        document.addEventListener(
            "prerenderingchange",
            () => {
                notifyLevelChanged(getCurrentLevel());
            },
            { once: true }
        );
    }

    /**
     * When the user navigates Back/Forward, Chrome (and Firefox) may restore
     * the page from the back/forward cache: the document — including our
     * overlay — is resurrected intact, but the content script does not re-run,
     * so applyOnLoad/notifyLevelChanged never fire and the toolbar badge is
     * left blank. A pageshow event with persisted === true signals a bfcache
     * restore; re-notify so the badge reflects the still-applied level without
     * needing a manual tab switch.
     */
    window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
            notifyLevelChanged(getCurrentLevel());
        }
    });

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
            saveSite(message.level);
        } else if (message.command === "unsaveSite") {
            unsaveSite();
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
        return levelFromOverlayColor(overlay.style.backgroundColor);
    }

    applyOnLoad();
})();
