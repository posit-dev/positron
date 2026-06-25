/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../../nls.js';
import { registerNotebookModelSetting } from '../../registerModelSetting.js';

// Configuration key for the visualize suggestion model patterns.
export const VISUALIZE_MODEL_KEY = 'positron.assistant.notebook.visualize.model';

// Command ID for selecting the visualize model.
const SELECT_VISUALIZE_MODEL_COMMAND_ID = 'positronNotebook.selectVisualizeModel';

registerNotebookModelSetting({
	configId: 'positron.notebookVisualize',
	title: localize('positronNotebookVisualizeConfigurationTitle', "Positron Notebook Visualize"),
	settingKey: VISUALIZE_MODEL_KEY,
	description: localize(
		'positron.assistant.notebook.visualize.model',
		'Model patterns for AI visualization suggestions. [Select a model](command:positronNotebook.selectVisualizeModel) or specify patterns manually. Patterns are tried in order until one matches an available model (case-insensitive). When left empty, the default fast/cheap tier is used.'
	),
	commandId: SELECT_VISUALIZE_MODEL_COMMAND_ID,
	commandTitle: localize2('positronNotebook.selectVisualizeModel', 'Select Visualize Model'),
	pickerTitle: localize('positronNotebook.selectVisualizeModel.title', "Select Model for Visualizations"),
});
