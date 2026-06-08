/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const themesDir = path.join(repoRoot, 'extensions', 'theme-defaults', 'themes');
const outputDir = path.join(repoRoot, '.storybook', 'generated');

/**
 * Read a theme JSON file, stripping JSON5-style comments and trailing commas.
 * Handles comments that appear outside of string literals.
 */
function readThemeJson(filePath) {
	const raw = fs.readFileSync(filePath, 'utf-8');
	// Strip comments while preserving string contents.
	// Match strings (to skip them), single-line comments, or block comments.
	const stripped = raw.replace(
		/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
		(match) => match.startsWith('"') ? match : ''
	);
	// Remove trailing commas before } or ]
	const noTrailingCommas = stripped.replace(/,(\s*[}\]])/g, '$1');
	return JSON.parse(noTrailingCommas);
}

/**
 * Recursively resolve the include chain for a theme file.
 * Parent colors are loaded first, then child colors override.
 * @returns A merged colors object.
 */
function resolveThemeColors(themeFilePath) {
	const theme = readThemeJson(themeFilePath);
	let colors = {};

	// If this theme includes a parent, resolve the parent first
	if (theme.include) {
		const parentPath = path.resolve(path.dirname(themeFilePath), theme.include);
		colors = resolveThemeColors(parentPath);
	}

	// Merge this theme's colors on top (child overrides parent)
	if (theme.colors) {
		Object.assign(colors, theme.colors);
	}

	return colors;
}

/**
 * Convert a VS Code color key to a CSS custom property name.
 * e.g. "editor.background" -> "--vscode-editor-background"
 */
function colorKeyToCssProperty(key) {
	return '--vscode-' + key.replace(/\./g, '-');
}

/**
 * Generate a CSS block with custom properties from a colors object.
 */
function generateCssBlock(selector, colors) {
	const entries = Object.entries(colors).sort(([a], [b]) => a.localeCompare(b));
	const lines = entries.map(([key, value]) => `\t${colorKeyToCssProperty(key)}: ${value};`);
	return `${selector} {\n${lines.join('\n')}\n}\n`;
}

// Resolve colors for both themes
const darkColors = resolveThemeColors(path.join(themesDir, 'positron_dark.json'));
const lightColors = resolveThemeColors(path.join(themesDir, 'positron_light.json'));

// Ensure output directory exists
fs.mkdirSync(outputDir, { recursive: true });

// Generate individual theme files
const darkCss = generateCssBlock('.sb-theme-dark', darkColors);
const lightCss = generateCssBlock('.sb-theme-light', lightColors);

fs.writeFileSync(path.join(outputDir, 'theme-dark.css'), darkCss);
fs.writeFileSync(path.join(outputDir, 'theme-light.css'), lightCss);

// Generate combined file with :root defaulting to dark
const allCss = [
	generateCssBlock(':root', darkColors),
	'',
	darkCss,
	'',
	lightCss,
].join('\n');

fs.writeFileSync(path.join(outputDir, 'theme-all.css'), allCss);

console.log(`Generated theme CSS files in ${path.relative(repoRoot, outputDir)}/`);
console.log(`  theme-dark.css  (${Object.keys(darkColors).length} properties)`);
console.log(`  theme-light.css (${Object.keys(lightColors).length} properties)`);
console.log(`  theme-all.css   (combined with :root default)`);
