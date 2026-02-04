/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

// Configuration key for the Positron notebook setting
export const POSITRON_NOTEBOOK_ENABLED_KEY = 'positron.notebook.enabled';

// Configuration key for assistant auto-follow setting
export const POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY = 'positron.assistant.notebook.autoFollow';

// Configuration key for deletion sentinel timeout setting
export const POSITRON_NOTEBOOK_DELETION_SENTINEL_TIMEOUT_KEY = 'positron.assistant.notebook.deletionSentinel.timeout';

// Configuration key for showing/hiding deletion sentinels
export const POSITRON_NOTEBOOK_SHOW_DELETION_SENTINELS_KEY = 'positron.assistant.notebook.deletionSentinel.show';

// Configuration key for showing diff view for assistant edits
export const POSITRON_NOTEBOOK_ASSISTANT_SHOW_DIFF_KEY = 'positron.assistant.notebook.showDiff';

// Configuration key for enabling inline data explorer in notebook outputs
export const POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_ENABLED_KEY = 'positron.notebook.inlineDataExplorer.enabled';

// Configuration key for inline data explorer max height
export const POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_MAX_HEIGHT_KEY = 'positron.notebook.inlineDataExplorer.maxHeight';

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({
	id: 'positron',
	order: 7,
	title: localize('positronConfigurationTitle', "Positron"),
	type: 'object',
	properties: {
		[POSITRON_NOTEBOOK_ENABLED_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.enablePositronNotebook',
				'Use Positron Notebook as the default editor for `.ipynb` files.'
			),
			tags: ['preview'],
			scope: ConfigurationScope.WINDOW,
		},
		[POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.assistant.notebook.autoFollow',
				'Automatically scroll to cells modified by the AI assistant. When enabled, cells modified outside the viewport will be automatically scrolled into view and highlighted.'
			),
			scope: ConfigurationScope.WINDOW,
		},
		[POSITRON_NOTEBOOK_DELETION_SENTINEL_TIMEOUT_KEY]: {
			type: 'number',
			default: 10000,
			minimum: 0,
			maximum: 60000,
			markdownDescription: localize(
				'positron.assistant.notebook.deletionSentinel.timeout',
				'Time in milliseconds before deletion sentinels auto-dismiss (0 to disable auto-dismiss).'
			),
			scope: ConfigurationScope.WINDOW,
		},
		[POSITRON_NOTEBOOK_SHOW_DELETION_SENTINELS_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.assistant.notebook.deletionSentinel.show',
				'Show deletion sentinels when cells are deleted. When disabled, cells are deleted immediately without undo placeholders.'
			),
			scope: ConfigurationScope.WINDOW,
		},
		[POSITRON_NOTEBOOK_ASSISTANT_SHOW_DIFF_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.assistant.notebook.showDiff',
				'Show diff view for AI assistant edits to notebook cells. When disabled, changes are applied directly without requiring approval.'
			),
			scope: ConfigurationScope.WINDOW,
		},
		[POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_ENABLED_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.notebook.inlineDataExplorer.enabled',
				'Display DataFrames inline in notebook outputs. When enabled, pandas and polars DataFrames are displayed as interactive data grids instead of static HTML tables.'
			),
			scope: ConfigurationScope.WINDOW,
		},
		[POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_MAX_HEIGHT_KEY]: {
			type: 'number',
			default: 300,
			minimum: 100,
			maximum: 800,
			markdownDescription: localize(
				'positron.notebook.inlineDataExplorer.maxHeight',
				'Maximum height in pixels for inline data explorer in notebook outputs.'
			),
			scope: ConfigurationScope.WINDOW,
		},
	},
});
