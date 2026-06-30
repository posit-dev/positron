/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { registerNotebookModelSetting } from '../registerModelSetting.js';

// Configuration key for notebook AI suggestion model patterns.
export const NOTEBOOK_SUGGESTIONS_MODEL_KEY = 'positron.assistant.notebook.suggestions.model';

// Command ID for selecting the notebook suggestions model.
const SELECT_SUGGESTIONS_MODEL_COMMAND_ID = 'positronNotebook.selectSuggestionsModel';

registerNotebookModelSetting({
	configId: 'positron.notebookSuggestions',
	title: localize('positronNotebookSuggestionsConfigurationTitle', "Positron Notebook AI Suggestions"),
	settingKey: NOTEBOOK_SUGGESTIONS_MODEL_KEY,
	description: localize(
		'positron.assistant.notebook.suggestions.model',
		'Model patterns for AI notebook suggestions. [Select a model](command:positronNotebook.selectSuggestionsModel) or specify patterns manually. Patterns are tried in order until one matches an available model (case-insensitive). When left empty, the default fast/cheap tier is used.'
	),
	commandId: SELECT_SUGGESTIONS_MODEL_COMMAND_ID,
	commandTitle: localize2('positronNotebook.selectSuggestionsModel', 'Select Notebook Suggestions Model'),
	pickerTitle: localize('positronNotebook.selectSuggestionsModel.title', "Select Model for Notebook Suggestions"),
});
