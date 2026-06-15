/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Positron ships with a subset of the upstream Visual Studio Code color themes.
// This filter is applied at picker-display time only; hidden themes remain
// registered and continue to resolve from settings.json by ID.
export function isColorThemeVisibleInPicker(themeId: string, currentThemeId: string): boolean {
	if (themeId === currentThemeId) {
		return true;
	}
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
			return false;
		default:
			return true;
	}
}
