/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Configuration key for the Quarto inline output setting.
 */
export const POSITRON_QUARTO_INLINE_OUTPUT_KEY = 'positron.quarto.inlineOutput.enabled';

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

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);

configurationRegistry.registerConfiguration({
	id: 'positron',
	order: 7,
	title: localize('positronConfigurationTitle', 'Positron'),
	type: 'object',
	properties: {
		[POSITRON_QUARTO_INLINE_OUTPUT_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.quarto.inlineOutput.enabled',
				'Enable inline output display for Quarto documents. When enabled, code execution results appear directly in the editor below the executed cell.'
			),
			tags: ['preview'],
			scope: ConfigurationScope.WINDOW,
		},
	},
});

/**
 * Helper function to check if Quarto inline output is enabled.
 * @param configurationService The configuration service instance
 * @returns true if Quarto inline output is enabled
 */
export function usingQuartoInlineOutput(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
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
