/**
 * Background script that keeps the toolbar icon badge in sync with the shade
 * level of the active tab.
 */

/**
 * Badge colours: a medium yellow when the level comes from a saved site, and
 * the default blue-grey otherwise (e.g. a "shade by default" level).
 */
const SAVED_BADGE_COLOR = "#fdeaaf";
const DEFAULT_BADGE_COLOR = "#5a5a8f";

/**
 * Set (or clear) the badge for a given tab. A level of 0 clears the badge;
 * any higher level shows the percentage. The badge colour reflects whether the
 * level comes from a saved site.
 */
function setBadgeForTab(tabId, level, saved) {
    if (typeof tabId !== "number") {
        return;
    }
    const text = level > 0 ? `${level}` : "";
    browser.action.setBadgeText({ tabId, text });
    browser.action.setBadgeBackgroundColor({
        tabId,
        color: saved ? SAVED_BADGE_COLOR : DEFAULT_BADGE_COLOR,
    });
}

/**
 * Ask the content script in a tab for its current shade level and update the
 * badge accordingly. Tabs without a reachable content script (e.g. about:
 * pages) simply get a cleared badge.
 */
async function refreshBadgeForTab(tabId) {
    try {
        const response = await browser.tabs.sendMessage(tabId, {
            command: "getState",
        });
        const level =
            response && typeof response.level === "number" ? response.level : 0;
        const saved = !!(response && response.saved);
        setBadgeForTab(tabId, level, saved);
    } catch (error) {
        // No content script in this tab; make sure the badge is cleared.
        setBadgeForTab(tabId, 0, false);
    }
}

/**
 * Listen for level-change notifications from content scripts and update the
 * badge for the tab the message came from.
 */
browser.runtime.onMessage.addListener((message, sender) => {
    if (message && message.command === "levelChanged" && sender.tab) {
        setBadgeForTab(sender.tab.id, message.level, !!message.saved);
    }
});

/**
 * When the user switches tabs, refresh the badge to match the newly active tab.
 */
browser.tabs.onActivated.addListener((activeInfo) => {
    refreshBadgeForTab(activeInfo.tabId);
});

/**
 * Refresh the badge for whichever tab is currently active. Used when the
 * background context (re)starts, so the badge is correct even if no tab-switch
 * event fired to trigger a refresh.
 */
async function refreshActiveTabBadge() {
    try {
        const [tab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
        });
        if (tab) {
            await refreshBadgeForTab(tab.id);
        }
    } catch (error) {
        // No active tab or query unavailable; nothing to refresh.
    }
}

/**
 * On Chrome MV3 the background runs as a non-persistent service worker that is
 * torn down when idle and restarted on events. When it restarts (browser
 * launch, extension install/update, or a cold wake) the badge state is lost, so
 * re-derive it for the active tab. These listeners are harmless on Firefox.
 */
browser.runtime.onStartup.addListener(refreshActiveTabBadge);
browser.runtime.onInstalled.addListener(refreshActiveTabBadge);

/**
 * How much each dim shortcut press changes the shade level.
 */
const STEP = 5;

/**
 * Handle keyboard shortcuts. Commands fire globally, so we look up the active
 * tab and forward the appropriate instruction to its content script.
 */
browser.commands.onCommand.addListener(async (command) => {
    let message;
    if (command === "dim-increase") {
        message = { command: "adjustLevel", delta: STEP };
    } else if (command === "dim-decrease") {
        message = { command: "adjustLevel", delta: -STEP };
    } else if (command === "toggle-shade") {
        message = { command: "toggleShade" };
    } else {
        return;
    }

    try {
        const [tab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
        });
        if (tab) {
            await browser.tabs.sendMessage(tab.id, message);
        }
    } catch (error) {
        // The active tab may have no content script (e.g. about: pages).
        console.error(`TabShade shortcut failed: ${error}`);
    }
});
