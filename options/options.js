const STORAGE_KEY = "shadedDomains";

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
    if (area === "local" && changes[STORAGE_KEY] && !document.hidden) {
        // Only re-render when the options page is not the active editor to
        // avoid yanking a slider out from under the user mid-drag.
        if (document.activeElement && document.activeElement.type === "range") {
            return;
        }
        render();
    }
});

render();
