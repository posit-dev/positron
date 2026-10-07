/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Positron ships with a subset of the upstream Visual Studio Code color themes.
// The filter applies to the theme pickers only. Theme lookups by ID (for
// example, the light/dark toggle) and the color theme settings schema are not
// filtered, so a hidden theme set in settings.json is valid.
//
// The theme-defaults IDs below ship in every build; they remain registered and
// continue to resolve from settings.json by ID. The other single-theme
// extensions (abyss, monokai, etc.) are excluded from release packaging in
// build/lib/extensions.ts, so release builds cannot resolve them. They still
// load when running from sources, so they stay listed here to keep the picker
// the same in dev and release builds.
export function isColorThemeVisibleInPicker(themeId: string, currentThemeId: string): boolean {
	if (themeId === currentThemeId) {
		return true;
	}
	return !isColorThemeHidden(themeId);
}

/**
 * Returns true for upstream color themes that Positron leaves out of the theme
 * pickers. Hidden themes stay registered, so lookups by ID (the light/dark
 * toggle, settings.json) still resolve them.
 */
function isColorThemeHidden(themeId: string): boolean {
	switch (themeId) {
		case 'vs vscode-theme-defaults-themes-light_modern-json':
		case 'vs vscode-theme-defaults-themes-light_plus-json':
		case 'vs vscode-theme-defaults-themes-light_vs-json':
		case 'vs vscode-theme-quietlight-themes-quietlight-color-theme-json':
		case 'vs vscode-theme-solarized-light-themes-solarized-light-color-theme-json':
		case 'vs-dark vscode-theme-abyss-themes-abyss-color-theme-json':
		case 'vs-dark vscode-theme-defaults-themes-dark_modern-json':
		case 'vs-dark vscode-theme-defaults-themes-dark_plus-json':
		case 'vs-dark vscode-theme-defaults-themes-dark_vs-json':
		case 'vs-dark vscode-theme-kimbie-dark-themes-kimbie-dark-color-theme-json':
		case 'vs-dark vscode-theme-monokai-dimmed-themes-dimmed-monokai-color-theme-json':
		case 'vs-dark vscode-theme-monokai-themes-monokai-color-theme-json':
		case 'vs-dark vscode-theme-red-themes-Red-color-theme-json':
		case 'vs-dark vscode-theme-solarized-dark-themes-solarized-dark-color-theme-json':
			return true;
		default:
			return false;
	}
}
