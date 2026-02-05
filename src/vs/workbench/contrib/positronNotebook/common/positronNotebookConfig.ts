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

// Configuration key for enabling ghost cell suggestions after cell execution
export const POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY = 'positron.assistant.notebook.ghostCellSuggestions.enabled';

// Configuration key for ghost cell suggestion delay
export const POSITRON_NOTEBOOK_GHOST_CELL_DELAY_KEY = 'positron.assistant.notebook.ghostCellSuggestions.delay';

// Configuration key for ghost cell automatic mode (true = automatic, false = on-demand)
export const POSITRON_NOTEBOOK_GHOST_CELL_AUTOMATIC_KEY = 'positron.assistant.notebook.ghostCellSuggestions.automatic';

// Configuration key for ghost cell suggestion model patterns
export const POSITRON_NOTEBOOK_GHOST_CELL_MODEL_KEY = 'positron.assistant.notebook.ghostCellSuggestions.model';

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
		[POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.assistant.notebook.ghostCellSuggestions.enabled',
				'Show AI-generated suggestions for the next cell after successful cell execution. A ghost cell with a suggested next step will appear after a brief delay.'
			),
			scope: ConfigurationScope.WINDOW,
		},
		[POSITRON_NOTEBOOK_GHOST_CELL_DELAY_KEY]: {
			type: 'number',
			default: 2000,
			minimum: 500,
			maximum: 10000,
			markdownDescription: localize(
				'positron.assistant.notebook.ghostCellSuggestions.delay',
				'Time in milliseconds to wait after cell execution before showing ghost cell suggestions. A shorter delay shows suggestions faster but may trigger unnecessary requests if you quickly execute multiple cells. A longer delay reduces requests but delays suggestions.'
			),
			scope: ConfigurationScope.WINDOW,
		},
		[POSITRON_NOTEBOOK_GHOST_CELL_AUTOMATIC_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.assistant.notebook.ghostCellSuggestions.automatic',
				'When enabled, suggestions appear automatically after cell execution. When disabled, a placeholder appears and you can request a suggestion by clicking "Get Suggestion" or pressing Cmd/Ctrl+Shift+G.'
			),
			scope: ConfigurationScope.WINDOW,
		},
		[POSITRON_NOTEBOOK_GHOST_CELL_MODEL_KEY]: {
			type: 'array',
			items: { type: 'string' },
			default: ['haiku', 'mini'],
			markdownDescription: localize(
				'positron.assistant.notebook.ghostCellSuggestions.model',
				'Model patterns for ghost cell suggestions. [Select a model](command:positron-assistant.selectGhostCellModel) or specify patterns manually. Patterns are tried in order until a match is found (case-insensitive partial matching). Falls back to the current chat session model, then the provider\'s model, then the first available model.'
			),
			scope: ConfigurationScope.WINDOW,
		},
	},
});
