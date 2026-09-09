/**
 * Background script that keeps the toolbar icon badge in sync with the shade
 * level of the active tab.
 */

/**
 * Set (or clear) the badge for a given tab. A level of 0 clears the badge;
 * any higher level shows the percentage.
 */
function setBadgeForTab(tabId, level) {
    if (typeof tabId !== "number") {
        return;
    }
    const text = level > 0 ? `${level}` : "";
    browser.action.setBadgeText({ tabId, text });
}

/**
 * Ask the content script in a tab for its current shade level and update the
 * badge accordingly. Tabs without a reachable content script (e.g. about:
 * pages) simply get a cleared badge.
 */
async function refreshBadgeForTab(tabId) {
    try {
        const response = await browser.tabs.sendMessage(tabId, {
            command: "getLevel",
        });
        const level =
            response && typeof response.level === "number" ? response.level : 0;
        setBadgeForTab(tabId, level);
    } catch (error) {
        // No content script in this tab; make sure the badge is cleared.
        setBadgeForTab(tabId, 0);
    }
}

/**
 * Listen for level-change notifications from content scripts and update the
 * badge for the tab the message came from.
 */
browser.runtime.onMessage.addListener((message, sender) => {
    if (message && message.command === "levelChanged" && sender.tab) {
        setBadgeForTab(sender.tab.id, message.level);
    }
});

/**
 * When the user switches tabs, refresh the badge to match the newly active tab.
 */
browser.tabs.onActivated.addListener((activeInfo) => {
    refreshBadgeForTab(activeInfo.tabId);
});

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

/**
 * Give the badge a consistent look.
 */
browser.action.setBadgeBackgroundColor({ color: "#5a5a8f" });
