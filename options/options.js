const STORAGE_KEY = "shadedDomains";
const SETTINGS_KEY = "settings";

// Shared pure helper (see lib/tabshade-core.js), loaded before this script.
const { normalizeLevel } = globalThis.TabShade;

/**
 * Read the global settings object from storage, preserving unknown fields.
 */
async function getSettings() {
    const result = await browser.storage.local.get(SETTINGS_KEY);
    const stored = result[SETTINGS_KEY];
    return stored && typeof stored === "object" ? { ...stored } : {};
}

/**
 * Update the theme setting without disturbing other settings fields.
 */
async function saveTheme(theme) {
    const settings = await getSettings();
    settings.theme = theme;
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Apply the given theme ("light" or "dark") to the preferences page.
 */
function applyTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
}

/**
 * Initialise the dark-theme checkbox from storage and persist changes to it.
 * The theme applies to both the popup and this preferences page.
 */
async function initThemeControl() {
    const checkbox = document.querySelector("#dark-theme");
    const settings = await getSettings();
    const isDark = settings.theme === "dark";
    checkbox.checked = isDark;
    applyTheme(isDark ? "dark" : "light");
    checkbox.addEventListener("change", () => {
        const theme = checkbox.checked ? "dark" : "light";
        applyTheme(theme);
        saveTheme(theme);
    });
}

/**
 * Merge a partial set of fields into the stored settings, preserving the rest.
 */
async function updateSettings(fields) {
    const settings = await getSettings();
    Object.assign(settings, fields);
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Update a slider's position and its "%" label together.
 */
function setDefaultSlider(level) {
    const slider = document.querySelector("#default-level");
    const valueEl = document.querySelector("#default-level-value");
    slider.value = String(level);
    valueEl.textContent = `${level}%`;
}

/**
 * Enable or disable the default-level slider and the "Ignore dark sites"
 * checkbox depending on whether shading by default is switched on.
 */
function setShadingSectionEnabled(enabled) {
    const section = document.querySelector("#shading");
    section.classList.toggle("disabled", !enabled);
    document.querySelector("#default-level").disabled = !enabled;
    document.querySelector("#skip-dark-sites").disabled = !enabled;
}

/**
 * Initialise the "Shade by default" toggle, its default-level slider, and the
 * "Ignore dark sites" checkbox from storage, and persist changes to each.
 */
async function initShadingControls() {
    const settings = await getSettings();

    const toggle = document.querySelector("#shade-by-default");
    const slider = document.querySelector("#default-level");
    const skipDark = document.querySelector("#skip-dark-sites");

    toggle.checked = !!settings.shadeByDefault;
    setDefaultSlider(normalizeLevel(settings.defaultLevel));
    skipDark.checked = !!settings.skipDarkSites;
    setShadingSectionEnabled(!!settings.shadeByDefault);

    toggle.addEventListener("change", async () => {
        setShadingSectionEnabled(toggle.checked);
        await updateSettings({ shadeByDefault: toggle.checked });
    });

    slider.addEventListener("input", async () => {
        const level = normalizeLevel(slider.value);
        setDefaultSlider(level);
        await updateSettings({ defaultLevel: level });
    });

    skipDark.addEventListener("change", async () => {
        await updateSettings({ skipDarkSites: skipDark.checked });
    });
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
 * Persist a new shade level for a domain. A level of 0 removes the domain so
 * it is no longer shaded automatically.
 */
async function saveLevel(domain, level) {
    const domains = await getShadedDomains();
    const normalized = normalizeLevel(level);
    if (normalized <= 0) {
        delete domains[domain];
    } else {
        domains[domain] = normalized;
    }
    await browser.storage.local.set({ [STORAGE_KEY]: domains });
}

/**
 * Build the DOM for a single domain row.
 */
function createDomainRow(domain, level) {
    const row = document.createElement("li");
    row.className = "domain-row";
    row.dataset.domain = domain;

    const name = document.createElement("span");
    name.className = "domain-name";
    name.textContent = domain;

    const remove = document.createElement("button");
    remove.className = "domain-remove";
    remove.type = "button";
    remove.textContent = "Remove";

    const control = document.createElement("div");
    control.className = "domain-control";

    const slider = document.createElement("input");
    slider.className = "domain-slider";
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(level);

    const value = document.createElement("span");
    value.className = "domain-value";
    value.textContent = `${level}%`;

    // Live-update the shown percentage while dragging, and persist the change.
    slider.addEventListener("input", async (e) => {
        const newLevel = normalizeLevel(e.target.value);
        value.textContent = `${newLevel}%`;
        await saveLevel(domain, newLevel);
        // If the domain has been turned off, drop the row from the list.
        if (newLevel <= 0) {
            removeRow(row);
        }
    });

    remove.addEventListener("click", async () => {
        await saveLevel(domain, 0);
        removeRow(row);
    });

    control.appendChild(slider);
    control.appendChild(value);

    row.appendChild(name);
    row.appendChild(remove);
    row.appendChild(control);
    return row;
}

/**
 * Remove a row from the list and show the empty message if none remain.
 */
function removeRow(row) {
    row.remove();
    updateEmptyState();
}

/**
 * Show or hide the "no domains" message based on the current list contents.
 */
function updateEmptyState() {
    const list = document.querySelector("#domain-list");
    const emptyMessage = document.querySelector("#empty-message");
    const hasRows = list.children.length > 0;
    list.classList.toggle("hidden", !hasRows);
    emptyMessage.classList.toggle("hidden", hasRows);
}

/**
 * Render the full list of domains from storage.
 */
async function render() {
    const list = document.querySelector("#domain-list");
    list.textContent = "";

    const domains = await getShadedDomains();
    const names = Object.keys(domains).sort();

    for (const domain of names) {
        list.appendChild(createDomainRow(domain, normalizeLevel(domains[domain])));
    }

    updateEmptyState();
}

/**
 * Re-render when storage changes elsewhere (e.g. a page is shaded from the
 * popup while this page is open), but skip changes originating from our own
 * slider edits to avoid disrupting an in-progress drag.
 */
browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
        return;
    }

    // Keep the shading controls in sync when settings change elsewhere (e.g.
    // the popup), unless the user is mid-drag on this page's slider.
    if (changes[SETTINGS_KEY] && !document.hidden) {
        const activeEl = document.activeElement;
        const draggingHere = activeEl && activeEl.id === "default-level";
        if (!draggingHere) {
            syncShadingControls();
        }
    }

    if (changes[STORAGE_KEY] && !document.hidden) {
        // Only re-render when the options page is not the active editor to
        // avoid yanking a slider out from under the user mid-drag.
        if (document.activeElement && document.activeElement.type === "range") {
            return;
        }
        render();
    }
});

/**
 * Refresh the shading controls from stored settings without re-attaching
 * listeners. Used when settings change from another surface (e.g. the popup).
 */
async function syncShadingControls() {
    const settings = await getSettings();
    document.querySelector("#shade-by-default").checked = !!settings.shadeByDefault;
    setDefaultSlider(normalizeLevel(settings.defaultLevel));
    document.querySelector("#skip-dark-sites").checked = !!settings.skipDarkSites;
    setShadingSectionEnabled(!!settings.shadeByDefault);

    // Keep the theme in sync if it was changed from the popup.
    const isDark = settings.theme === "dark";
    document.querySelector("#dark-theme").checked = isDark;
    applyTheme(isDark ? "dark" : "light");
}

initThemeControl();
initShadingControls();
render();
