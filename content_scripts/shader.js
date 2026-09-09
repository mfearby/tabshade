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
    const STORAGE_KEY = "shadedDomains";

    /**
     * The maximum opacity the overlay reaches at 100%. Kept below 1 so a fully
     * shaded page is still faintly visible rather than completely black.
     */
    const MAX_OPACITY = 0.9;

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
     * Read the map of remembered domains (domain -> shade level) from local
     * storage. Returns a plain object.
     */
    async function getShadedDomains() {
        const result = await browser.storage.local.get(STORAGE_KEY);
        const stored = result[STORAGE_KEY];
        return stored && typeof stored === "object" ? stored : {};
    }

    /**
     * Remember the given domain and its shade level in local storage. A level
     * of 0 removes the domain so it is no longer shaded automatically.
     */
    async function rememberDomain(domain, level) {
        if (!domain) {
            return;
        }
        const domains = await getShadedDomains();
        if (level <= 0) {
            delete domains[domain];
        } else {
            domains[domain] = level;
        }
        await browser.storage.local.set({ [STORAGE_KEY]: domains });
    }

    /**
     * Read the remembered shade level for the given domain, or 0 if none.
     */
    async function getLevelForDomain(domain) {
        if (!domain) {
            return 0;
        }
        const domains = await getShadedDomains();
        return normalizeLevel(domains[domain]);
    }

    /**
     * Apply the given shade level to the page. A level of 0 removes the
     * overlay; any higher level creates or updates it with a matching opacity.
     */
    function applyLevel(level) {
        const normalized = normalizeLevel(level);
        let overlay = document.getElementById(OVERLAY_ID);

        if (normalized <= 0) {
            if (overlay) {
                overlay.remove();
            }
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
    }

    /**
     * Notify the background script that this tab's shade level changed, so it
     * can update the badge shown on the toolbar icon.
     */
    function notifyLevelChanged(level) {
        browser.runtime
            .sendMessage({ command: "levelChanged", level: normalizeLevel(level) })
            .catch(() => {
                // No receiver (e.g. background not ready); safe to ignore.
            });
    }

    /**
     * Set the shade level for the current page: apply it visually, remember
     * (or forget) the domain in local storage, and update the toolbar badge.
     */
    async function setLevel(level) {
        const normalized = normalizeLevel(level);
        applyLevel(normalized);
        await rememberDomain(getDomain(), normalized);
        notifyLevelChanged(normalized);
    }

    /**
     * On load, check whether the current domain has a remembered shade level,
     * apply it if so, and report the level for the toolbar badge.
     */
    async function applyIfRemembered() {
        const level = await getLevelForDomain(getDomain());
        if (level > 0) {
            applyLevel(level);
        }
        notifyLevelChanged(level);
    }

    /**
     * Listen for messages from the popup.
     */
    browser.runtime.onMessage.addListener((message) => {
        if (message.command === "setLevel") {
            setLevel(message.level);
        } else if (message.command === "getLevel") {
            return Promise.resolve({
                level: normalizeLevel(getCurrentLevel()),
            });
        }
    });

    /**
     * React to shade levels being changed elsewhere (e.g. from the preferences
     * page). If this domain's stored level differs from what is currently
     * applied, update the page and the toolbar badge to match.
     */
    browser.storage.onChanged.addListener(async (changes, area) => {
        if (area !== "local" || !changes[STORAGE_KEY]) {
            return;
        }
        const stored = await getLevelForDomain(getDomain());
        if (stored !== getCurrentLevel()) {
            applyLevel(stored);
            notifyLevelChanged(stored);
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

    applyIfRemembered();
})();
