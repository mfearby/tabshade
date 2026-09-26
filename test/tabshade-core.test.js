import { describe, it, expect } from "vitest";
import * as core from "../lib/tabshade-core.js";

// lib/tabshade-core.js exports via CommonJS (module.exports = api). Vite
// exposes that as the module's default; fall back to the namespace for safety.
const {
    normalizeLevel,
    normalizeSettings,
    resolveLevel,
    luminance,
    isDarkColor,
    overlayColorForLevel,
    levelFromOverlayColor,
    parseColor,
    badgeForLevel,
    MAX_OPACITY,
    DARK_LUMINANCE_THRESHOLD,
    SAVED_BADGE_COLOR,
    DEFAULT_BADGE_COLOR,
} = core.default || core;

describe("normalizeLevel", () => {
    it("passes valid integers through unchanged", () => {
        expect(normalizeLevel(0)).toBe(0);
        expect(normalizeLevel(50)).toBe(50);
        expect(normalizeLevel(100)).toBe(100);
    });

    it("clamps to the 0-100 range", () => {
        expect(normalizeLevel(-10)).toBe(0);
        expect(normalizeLevel(150)).toBe(100);
    });

    it("rounds fractional values", () => {
        expect(normalizeLevel(49.4)).toBe(49);
        expect(normalizeLevel(49.6)).toBe(50);
    });

    it("coerces numeric strings", () => {
        expect(normalizeLevel("42")).toBe(42);
    });

    it("returns 0 for non-numeric or missing input", () => {
        expect(normalizeLevel("abc")).toBe(0);
        expect(normalizeLevel(NaN)).toBe(0);
        expect(normalizeLevel(undefined)).toBe(0);
        expect(normalizeLevel(null)).toBe(0);
        expect(normalizeLevel(Infinity)).toBe(0);
    });
});

describe("normalizeSettings", () => {
    it("fills defaults for missing/empty input", () => {
        expect(normalizeSettings(undefined)).toEqual({
            shadeByDefault: false,
            defaultLevel: 0,
            skipDarkSites: false,
            theme: "light",
        });
        expect(normalizeSettings({})).toEqual({
            shadeByDefault: false,
            defaultLevel: 0,
            skipDarkSites: false,
            theme: "light",
        });
    });

    it("coerces booleans and normalises the level", () => {
        expect(
            normalizeSettings({
                shadeByDefault: 1,
                defaultLevel: "150",
                skipDarkSites: "yes",
                theme: "dark",
            })
        ).toEqual({
            shadeByDefault: true,
            defaultLevel: 100,
            skipDarkSites: true,
            theme: "dark",
        });
    });

    it("treats any theme other than 'dark' as light", () => {
        expect(normalizeSettings({ theme: "solarized" }).theme).toBe("light");
        expect(normalizeSettings({ theme: "dark" }).theme).toBe("dark");
    });
});

describe("resolveLevel", () => {
    it("prefers a saved level above everything else", () => {
        const level = resolveLevel({
            isSaved: true,
            savedLevel: 30,
            shadeByDefault: true,
            defaultLevel: 80,
            skipDarkSites: true,
            isDark: true,
        });
        expect(level).toBe(30);
    });

    it("normalises the saved level", () => {
        expect(resolveLevel({ isSaved: true, savedLevel: 999 })).toBe(100);
    });

    it("uses the default level when shading by default and not saved", () => {
        expect(
            resolveLevel({
                isSaved: false,
                shadeByDefault: true,
                defaultLevel: 40,
                skipDarkSites: false,
                isDark: false,
            })
        ).toBe(40);
    });

    it("skips a dark page when skipDarkSites is on", () => {
        expect(
            resolveLevel({
                isSaved: false,
                shadeByDefault: true,
                defaultLevel: 40,
                skipDarkSites: true,
                isDark: true,
            })
        ).toBe(0);
    });

    it("still shades a dark page when skipDarkSites is off", () => {
        expect(
            resolveLevel({
                isSaved: false,
                shadeByDefault: true,
                defaultLevel: 40,
                skipDarkSites: false,
                isDark: true,
            })
        ).toBe(40);
    });

    it("does not skip a light page even when skipDarkSites is on", () => {
        expect(
            resolveLevel({
                isSaved: false,
                shadeByDefault: true,
                defaultLevel: 40,
                skipDarkSites: true,
                isDark: false,
            })
        ).toBe(40);
    });

    it("returns 0 when shading by default is off", () => {
        expect(
            resolveLevel({
                isSaved: false,
                shadeByDefault: false,
                defaultLevel: 40,
            })
        ).toBe(0);
    });

    it("returns 0 for empty input", () => {
        expect(resolveLevel()).toBe(0);
        expect(resolveLevel({})).toBe(0);
    });
});

describe("luminance / isDarkColor", () => {
    it("computes weighted perceived luminance", () => {
        expect(luminance(0, 0, 0)).toBe(0);
        expect(luminance(255, 255, 255)).toBeCloseTo(255, 5);
        // Green is weighted most heavily.
        expect(luminance(0, 255, 0)).toBeCloseTo(0.587 * 255, 5);
    });

    it("classifies clearly dark and light backgrounds", () => {
        expect(isDarkColor(0, 0, 0)).toBe(true);
        expect(isDarkColor(20, 20, 20)).toBe(true);
        expect(isDarkColor(255, 255, 255)).toBe(false);
        expect(isDarkColor(200, 200, 200)).toBe(false);
    });

    it("sits on the documented threshold boundary", () => {
        // A pure grey whose luminance equals the threshold is NOT dark
        // (strict less-than), while one just below it is.
        const atThreshold = DARK_LUMINANCE_THRESHOLD; // grey => luminance == value
        expect(isDarkColor(atThreshold, atThreshold, atThreshold)).toBe(false);
        expect(isDarkColor(atThreshold - 1, atThreshold - 1, atThreshold - 1)).toBe(
            true
        );
    });
});

describe("overlayColorForLevel / levelFromOverlayColor round-trip", () => {
    it("returns an empty string for no shading", () => {
        expect(overlayColorForLevel(0)).toBe("");
        expect(overlayColorForLevel(-5)).toBe("");
    });

    it("produces an rgba string scaled by MAX_OPACITY", () => {
        expect(overlayColorForLevel(100)).toBe(`rgba(0, 0, 0, ${MAX_OPACITY})`);
        expect(overlayColorForLevel(50)).toBe(
            `rgba(0, 0, 0, ${(50 / 100) * MAX_OPACITY})`
        );
    });

    it("recovers the level from the overlay colour", () => {
        for (const level of [5, 20, 50, 75, 100]) {
            const color = overlayColorForLevel(level);
            expect(levelFromOverlayColor(color)).toBe(level);
        }
    });

    it("returns 0 for empty or unparseable colour", () => {
        expect(levelFromOverlayColor("")).toBe(0);
        expect(levelFromOverlayColor("transparent")).toBe(0);
        expect(levelFromOverlayColor(null)).toBe(0);
    });
});

describe("parseColor", () => {
    it("parses rgb() without alpha (defaults alpha to 1)", () => {
        expect(parseColor("rgb(20, 30, 40)")).toEqual({
            r: 20,
            g: 30,
            b: 40,
            a: 1,
        });
    });

    it("parses rgba() with alpha", () => {
        expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual({
            r: 0,
            g: 0,
            b: 0,
            a: 0.5,
        });
    });

    it("returns null for empty or unrecognised input", () => {
        expect(parseColor("")).toBeNull();
        expect(parseColor(null)).toBeNull();
        expect(parseColor("not a color")).toBeNull();
    });
});

describe("badgeForLevel", () => {
    it("clears the badge text at level 0", () => {
        expect(badgeForLevel(0, false).text).toBe("");
        expect(badgeForLevel(0, true).text).toBe("");
    });

    it("shows the numeric level as text", () => {
        expect(badgeForLevel(35, false).text).toBe("35");
        expect(badgeForLevel(150, false).text).toBe("100");
    });

    it("uses the saved colour only for saved sites", () => {
        expect(badgeForLevel(35, true).color).toBe(SAVED_BADGE_COLOR);
        expect(badgeForLevel(35, false).color).toBe(DEFAULT_BADGE_COLOR);
    });
});
