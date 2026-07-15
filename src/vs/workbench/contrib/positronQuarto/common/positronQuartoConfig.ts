/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationChangeEvent, IConfigurationService, IConfigurationValue } from '../../../../platform/configuration/common/configuration.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

// Configuration keys for Quarto settings.
//
// These settings live in the bare `quarto.*` namespace. The original
// `positron.quarto.*` keys are kept as deprecated aliases so existing user
// settings keep working; reads prefer the new key and fall back to the old one
// (see `getQuartoConfigValue`). When retiring the aliases, also update the
// deprecated keys referenced by the Quarto extension and the Positron website.

/**
 * Configuration key for the Quarto inline output setting.
 */
export const QUARTO_INLINE_OUTPUT_ENABLED_KEY = 'quarto.inlineOutput.enabled';

/**
 * Configuration key for the maximum number of lines to display in inline text output.
 * If output exceeds this limit, only the last N lines are shown with a truncation indicator.
 */
export const QUARTO_INLINE_OUTPUT_MAX_LINES_KEY = 'quarto.inlineOutput.maxLines';

/**
 * Configuration key for the Quarto inline equation preview setting.
 * When enabled, display-math (`$$ ... $$`) equations are rendered inline below
 * their block in Quarto and R Markdown documents.
 */
export const QUARTO_EQUATION_PREVIEW_KEY = 'quarto.equationPreview.enabled';

/**
 * Configuration key for whether to show the cell toolbar on Quarto code cells.
 * Some users find the always-on toolbar distracting, so it can be hidden.
 */
export const QUARTO_INLINE_OUTPUT_SHOW_CELL_TOOLBAR_KEY = 'quarto.inlineOutput.showCellToolbar';

/**
 * Configuration key for splitting Quarto inline code into language-defined statements.
 */
export const QUARTO_INLINE_OUTPUT_SPLIT_STATEMENTS_KEY = 'quarto.inlineOutput.splitStatements';

/**
 * @deprecated Use {@link QUARTO_INLINE_OUTPUT_ENABLED_KEY}. Kept as a working alias.
 */
export const POSITRON_QUARTO_INLINE_OUTPUT_KEY = 'positron.quarto.inlineOutput.enabled';

/**
 * @deprecated Use {@link QUARTO_INLINE_OUTPUT_MAX_LINES_KEY}. Kept as a working alias.
 */
export const POSITRON_QUARTO_INLINE_OUTPUT_MAX_LINES_KEY = 'positron.quarto.inlineOutput.maxLines';

/**
 * @deprecated Use {@link QUARTO_EQUATION_PREVIEW_KEY}. Kept as a working alias.
 */
export const POSITRON_QUARTO_EQUATION_PREVIEW_KEY = 'positron.quarto.equationPreview.enabled';

/**
 * @deprecated Use {@link QUARTO_INLINE_OUTPUT_SHOW_CELL_TOOLBAR_KEY}. Kept as a working alias.
 */
export const POSITRON_QUARTO_INLINE_OUTPUT_SHOW_CELL_TOOLBAR_KEY = 'positron.quarto.inlineOutput.showCellToolbar';

/**
 * @deprecated Use {@link QUARTO_INLINE_OUTPUT_SPLIT_STATEMENTS_KEY}. Kept as a working alias.
 */
export const POSITRON_QUARTO_INLINE_OUTPUT_SPLIT_STATEMENTS_KEY = 'positron.quarto.inlineOutput.splitStatements';

/**
 * Context key for whether Quarto inline output is enabled.
 * Used for conditionally showing commands and menus.
 */
export const QUARTO_INLINE_OUTPUT_ENABLED = new RawContextKey<boolean>(
	'positron.quartoInlineOutputEnabled',
	false,
	localize('quartoInlineOutputEnabled', 'Whether Quarto inline output is enabled')
);

/**
 * Context key for whether the active editor is a Quarto document.
 */
export const IS_QUARTO_DOCUMENT = new RawContextKey<boolean>(
	'positron.isQuartoDocument',
	false,
	localize('isQuartoDocument', 'Whether the active editor is a Quarto document')
);

/**
 * Context key for whether the active Quarto document has a running kernel.
 * Used for conditionally showing kernel actions like shutdown.
 */
export const QUARTO_KERNEL_RUNNING = new RawContextKey<boolean>(
	'positron.quartoKernelRunning',
	false,
	localize('quartoKernelRunning', 'Whether the active Quarto document has a running kernel')
);

/**
 * Context key for whether the active Quarto document's kernel is busy executing code.
 * Used to disable actions like Change Kernel while code is running.
 */
export const QUARTO_KERNEL_BUSY = new RawContextKey<boolean>(
	'positron.quartoKernelBusy',
	false,
	localize('quartoKernelBusy', 'Whether the active Quarto document kernel is busy executing code')
);

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);

configurationRegistry.registerConfiguration({
	id: 'quarto',
	order: 7,
	title: localize('positron.quartoConfigurationTitle', 'Quarto'),
	type: 'object',
	properties: {
		[QUARTO_INLINE_OUTPUT_ENABLED_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.quarto.inlineOutput.enabled',
				'Enable inline output display for Quarto documents. When enabled, code execution results appear directly in the editor below the executed cell.'
			),
			scope: ConfigurationScope.WINDOW,
		},
		[QUARTO_INLINE_OUTPUT_MAX_LINES_KEY]: {
			type: 'number',
			default: 40,
			minimum: 5,
			maximum: 1000,
			markdownDescription: localize(
				'positron.quarto.inlineOutput.maxLines',
				'Maximum number of lines to display in inline text output. If output exceeds this limit, only the last N lines are shown with a link to open the full output in an editor.'
			),
			scope: ConfigurationScope.WINDOW,
		},
		[QUARTO_EQUATION_PREVIEW_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.quarto.equationPreview.enabled',
				'Render LaTeX display equations (`$$ ... $$`) inline below their block in Quarto and R Markdown documents. The preview updates as you edit the equation.'
			)
		},
		[QUARTO_INLINE_OUTPUT_SHOW_CELL_TOOLBAR_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.quarto.inlineOutput.showCellToolbar',
				'Show the floating cell toolbar (Run Cell, Run Previous, etc.) on Quarto code cells.'
			)
		},
		[QUARTO_INLINE_OUTPUT_SPLIT_STATEMENTS_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.quarto.inlineOutput.splitStatements',
				'Execute Quarto inline code statement by statement when the language provides input boundaries, so each statement can produce inline output.'
			),
			scope: ConfigurationScope.WINDOW,
		},
	},
});

// Deprecated aliases in the redundant `positron.quarto.*` namespace. These keep
// working (reads fall back to them) but nudge users toward the `quarto.*` keys
// above. Registered under the same "Quarto" title so they group together.
configurationRegistry.registerConfiguration({
	id: 'quarto',
	order: 7,
	title: localize('positron.quartoConfigurationTitle', 'Quarto'),
	type: 'object',
	properties: {
		[POSITRON_QUARTO_INLINE_OUTPUT_KEY]: {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.WINDOW,
			markdownDeprecationMessage: localize(
				'positron.quarto.inlineOutput.enabled.deprecated',
				'Deprecated. Use `#{0}#` instead.',
				QUARTO_INLINE_OUTPUT_ENABLED_KEY
			),
		},
		[POSITRON_QUARTO_INLINE_OUTPUT_MAX_LINES_KEY]: {
			type: 'number',
			default: 40,
			minimum: 5,
			maximum: 1000,
			scope: ConfigurationScope.WINDOW,
			markdownDeprecationMessage: localize(
				'positron.quarto.inlineOutput.maxLines.deprecated',
				'Deprecated. Use `#{0}#` instead.',
				QUARTO_INLINE_OUTPUT_MAX_LINES_KEY
			),
		},
		[POSITRON_QUARTO_EQUATION_PREVIEW_KEY]: {
			type: 'boolean',
			default: true,
			markdownDeprecationMessage: localize(
				'positron.quarto.equationPreview.enabled.deprecated',
				'Deprecated. Use `#{0}#` instead.',
				QUARTO_EQUATION_PREVIEW_KEY
			),
		},
		[POSITRON_QUARTO_INLINE_OUTPUT_SHOW_CELL_TOOLBAR_KEY]: {
			type: 'boolean',
			default: true,
			markdownDeprecationMessage: localize(
				'positron.quarto.inlineOutput.showCellToolbar.deprecated',
				'Deprecated. Use `#{0}#` instead.',
				QUARTO_INLINE_OUTPUT_SHOW_CELL_TOOLBAR_KEY
			),
		},
		[POSITRON_QUARTO_INLINE_OUTPUT_SPLIT_STATEMENTS_KEY]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.WINDOW,
			markdownDeprecationMessage: localize(
				'positron.quarto.inlineOutput.splitStatements.deprecated',
				'Deprecated. Use `#{0}#` instead.',
				QUARTO_INLINE_OUTPUT_SPLIT_STATEMENTS_KEY
			),
		},
	},
});

/**
 * Whether a configuration value has been explicitly set at any level (as opposed
 * to falling back to its registered default). Used to decide when to fall back
 * from a new `quarto.*` key to its deprecated `positron.quarto.*` alias.
 */
function isConfigurationSet<T>(inspection: IConfigurationValue<T>): boolean {
	return inspection.applicationValue !== undefined
		|| inspection.userValue !== undefined
		|| inspection.userLocalValue !== undefined
		|| inspection.userRemoteValue !== undefined
		|| inspection.workspaceValue !== undefined
		|| inspection.workspaceFolderValue !== undefined;
}

/**
 * Reads a Quarto setting, preferring the new `quarto.*` key and falling back to
 * the deprecated `positron.quarto.*` alias when the new key has not been
 * explicitly set. Uses `inspect` so an explicit `false`/`0` on either key is
 * honored over the registered default.
 * @param configurationService The configuration service instance
 * @param newKey The canonical `quarto.*` key
 * @param oldKey The deprecated `positron.quarto.*` alias
 * @param defaultValue The value to return when neither key is explicitly set
 */
export function getQuartoConfigValue<T>(
	configurationService: IConfigurationService,
	newKey: string,
	oldKey: string,
	defaultValue: T
): T {
	const newInspection = configurationService.inspect<T>(newKey);
	if (isConfigurationSet(newInspection)) {
		return configurationService.getValue<T>(newKey);
	}
	const oldInspection = configurationService.inspect<T>(oldKey);
	if (isConfigurationSet(oldInspection)) {
		return configurationService.getValue<T>(oldKey);
	}
	return defaultValue;
}

/**
 * Whether a configuration change event affects a Quarto setting under either its
 * new `quarto.*` key or its deprecated `positron.quarto.*` alias.
 * @param e The configuration change event
 * @param newKey The canonical `quarto.*` key
 * @param oldKey The deprecated `positron.quarto.*` alias
 */
export function affectsQuartoConfig(e: IConfigurationChangeEvent, newKey: string, oldKey: string): boolean {
	return e.affectsConfiguration(newKey) || e.affectsConfiguration(oldKey);
}

/**
 * Helper function to check if Quarto inline output is enabled.
 * @param configurationService The configuration service instance
 * @returns true if Quarto inline output is enabled
 */
export function usingQuartoInlineOutput(configurationService: IConfigurationService): boolean {
	return getQuartoConfigValue(configurationService, QUARTO_INLINE_OUTPUT_ENABLED_KEY, POSITRON_QUARTO_INLINE_OUTPUT_KEY, false);
}

/**
 * Helper function to check if the Quarto cell toolbar should be shown.
 * Defaults to true when the setting is unset.
 * @param configurationService The configuration service instance
 * @returns true if the cell toolbar should be shown
 */
export function usingQuartoCellToolbar(configurationService: IConfigurationService): boolean {
	return getQuartoConfigValue(configurationService, QUARTO_INLINE_OUTPUT_SHOW_CELL_TOOLBAR_KEY, POSITRON_QUARTO_INLINE_OUTPUT_SHOW_CELL_TOOLBAR_KEY, true);
}

/**
 * Helper function to check if Quarto inline output should split code at statement boundaries.
 * @param configurationService The configuration service instance
 * @returns true if statement splitting is enabled
 */
export function usingQuartoInlineOutputStatementSplitting(configurationService: IConfigurationService): boolean {
	return getQuartoConfigValue(configurationService, QUARTO_INLINE_OUTPUT_SPLIT_STATEMENTS_KEY, POSITRON_QUARTO_INLINE_OUTPUT_SPLIT_STATEMENTS_KEY, true);
}

/**
 * Language IDs that indicate a Quarto or RMarkdown document.
 * The Quarto extension sets these language modes for .qmd and .rmd files,
 * as well as for untitled documents created via "Quarto: New Document".
 */
export const QUARTO_LANGUAGE_IDS = ['quarto', 'rmd'];

/**
 * Helper function to check if a file path is a Quarto or RMarkdown document.
 * Supports .qmd (Quarto), .Rmd and .rmd (R Markdown) extensions.
 * @param path The file path to check
 * @returns true if the path is a Quarto or RMarkdown document
 */
export function isQuartoOrRmdFile(path: string | undefined): boolean {
	if (!path) {
		return false;
	}
	const lowerPath = path.toLowerCase();
	return lowerPath.endsWith('.qmd') || lowerPath.endsWith('.rmd');
}

/**
 * Helper function to check if a document is a Quarto or RMarkdown document.
 * This function supports both saved files (by path extension) and untitled files
 * (by language ID). Use this when you have access to the model's language ID.
 *
 * @param path The file path to check (can be undefined for untitled files)
 * @param languageId The language ID of the document model (e.g., 'quarto', 'rmd')
 * @returns true if the document is a Quarto or RMarkdown document
 */
export function isQuartoDocument(path: string | undefined, languageId: string | undefined): boolean {
	// First check by file extension (for saved files)
	if (isQuartoOrRmdFile(path)) {
		return true;
	}

	// Then check by language ID (for untitled files or when extension check fails)
	if (languageId && QUARTO_LANGUAGE_IDS.includes(languageId.toLowerCase())) {
		return true;
	}

	return false;
}
