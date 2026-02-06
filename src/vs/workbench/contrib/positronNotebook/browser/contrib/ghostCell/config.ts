/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../nls.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../../platform/registry/common/platform.js';

// Configuration key for enabling ghost cell suggestions after cell execution
export const POSITRON_NOTEBOOK_GHOST_CELL_SUGGESTIONS_KEY = 'positron.assistant.notebook.ghostCellSuggestions.enabled';

// Configuration key for ghost cell suggestion delay
export const POSITRON_NOTEBOOK_GHOST_CELL_DELAY_KEY = 'positron.assistant.notebook.ghostCellSuggestions.delay';

// Configuration key for ghost cell automatic mode (true = automatic, false = on-demand)
export const POSITRON_NOTEBOOK_GHOST_CELL_AUTOMATIC_KEY = 'positron.assistant.notebook.ghostCellSuggestions.automatic';

// Configuration key for ghost cell suggestion model patterns
export const POSITRON_NOTEBOOK_GHOST_CELL_MODEL_KEY = 'positron.assistant.notebook.ghostCellSuggestions.model';

// Register ghost cell configuration settings
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({
	id: 'positron.ghostCell',
	order: 8,
	title: localize('positronGhostCellConfigurationTitle', "Positron Ghost Cell Suggestions"),
	type: 'object',
	properties: {
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
