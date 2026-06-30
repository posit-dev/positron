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

// Single switch that gates all AI features in Positron notebooks. Sits below the
// global `ai.enabled` switch and above each feature's own settings.
export const NOTEBOOK_AI_ENABLED_KEY = 'notebook.ai.enabled';

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

// Configuration key that gates experimental Positron notebook features.
export const POSITRON_NOTEBOOK_EXPERIMENTAL_KEY = 'positron.notebook.experimental';

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
			default: true,
			markdownDescription: localize(
				'positron.enablePositronNotebook',
				'Use the Positron Notebook Editor for `.ipynb` files. When disabled, Positron uses the legacy notebook editor.'
			),
			tags: ['positronNotebook'],
			scope: ConfigurationScope.WINDOW,
		},
		[NOTEBOOK_AI_ENABLED_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.notebook.ai.enabled',
				'Enable AI features in notebooks, such as ghost cell suggestions, the notebook assistant, and Fix and Explain on cell errors. When disabled, all AI features in notebooks are turned off. The main AI features setting ({0}) must also be enabled.',
				'`#ai.enabled#`'
			),
			tags: ['positronNotebook'],
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
			tags: ['positronNotebook'],
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
			tags: ['positronNotebook'],
		},
		[POSITRON_NOTEBOOK_SHOW_DELETION_SENTINELS_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.assistant.notebook.deletionSentinel.show',
				'Show deletion sentinels when cells are deleted. When disabled, cells are deleted immediately without undo placeholders.'
			),
			scope: ConfigurationScope.WINDOW,
			tags: ['positronNotebook'],
		},
		[POSITRON_NOTEBOOK_ASSISTANT_SHOW_DIFF_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.assistant.notebook.showDiff',
				'Show diff view for AI assistant edits to notebook cells. When disabled, changes are applied directly without requiring approval.'
			),
			scope: ConfigurationScope.WINDOW,
			tags: ['positronNotebook'],
		},
		[POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_ENABLED_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.notebook.inlineDataExplorer.enabled',
				'Display data frames inline as interactive data grids instead of static HTML tables.'
			),
			scope: ConfigurationScope.WINDOW,
			tags: ['positronNotebook'],
		},
		[POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_MAX_HEIGHT_KEY]: {
			type: 'number',
			default: 300,
			minimum: 100,
			maximum: 800,
			markdownDescription: localize(
				'positron.notebook.inlineDataExplorer.maxHeight',
				'Maximum height in pixels for inline data explorers in notebook and Quarto outputs.'
			),
			scope: ConfigurationScope.WINDOW,
			tags: ['positronNotebook'],
		},
		[POSITRON_NOTEBOOK_EXPERIMENTAL_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.notebook.experimental',
				'Enable experimental features in the Positron notebook editor, such as the Visualize action for data frames. These features are under active development and may change or be removed without notice.'
			),
			tags: ['experimental', 'positronNotebook'],
			scope: ConfigurationScope.WINDOW,
		},
	},
});
