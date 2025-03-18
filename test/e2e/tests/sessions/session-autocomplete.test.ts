/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Hotkeys, Keyboard, pythonSession, pythonSessionAlt, rSession, rSessionAlt, SessionInfo } from '../../infra/index.js';
import { test, tags, expect } from '../_test.setup';

const pythonSession1a: SessionInfo = { ...pythonSession };
const pythonSession1b: SessionInfo = { ...pythonSession, name: `Python ${process.env.POSITRON_PY_VER_SEL} - 2`, };
const pythonSession2: SessionInfo = { ...pythonSessionAlt };
const rSession1a: SessionInfo = { ...rSession };
const rSession1b: SessionInfo = { ...rSession, name: `R ${process.env.POSITRON_R_VER_SEL} - 2`, };
const rSession2: SessionInfo = { ...rSessionAlt };

test.use({
	suiteId: __filename
});

test.describe('Session: Autocomplete', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Python - Verify autocomplete suggestions', async function ({ app, runCommand, keyboard }) {
		const { sessions, variables, editors } = app.workbench;

		pythonSession1a.id = await sessions.launch(pythonSession1a);
		pythonSession1b.id = await sessions.launch(pythonSession1b);
		pythonSession2.id = await sessions.launch(pythonSession2);

		// Session 1a - verify autocomplete suggestions
		await triggerAutocompleteInConsole(app, pythonSession1a);
		await expect(app.workbench.console.suggestionList).toHaveCount(8);

		// Session 1b - verify autocomplete suggestions
		await triggerAutocompleteInConsole(app, pythonSession1b);
		await expect(app.workbench.console.suggestionList).toHaveCount(8);

		// Open a new Python file
		await runCommand('Python: New Python File');
		await variables.togglePane('hide');

		// Session 1a - verify autocomplete suggestions
		await triggerAutocompleteInEditor(app, pythonSession1a, keyboard);
		await editors.expectSuggestionListCount(8);

		// Session 1b - verify autocomplete suggestions
		await retriggerAutocompleteInEditor(app, pythonSession1b, keyboard);
		await editors.expectSuggestionListCount(5); // why are we only getting 5?

		// Session 2 - verify no autocomplete
		await retriggerAutocompleteInEditor(app, pythonSession2, keyboard);
		await editors.expectSuggestionListCount(0);
	});

	test('R - Verify autocomplete suggestions', async function ({ app, runCommand, keyboard }) {
		const { sessions, variables, editors } = app.workbench;

		rSession1a.id = await sessions.reuseIdleSessionIfExists(rSession1a);
		rSession1b.id = await sessions.launch(rSession1b);
		rSession2.id = await sessions.launch(rSession2);

		// Session 1a - verify autocomplete suggestions
		await triggerAutocompleteInConsole(app, rSession1a);
		await expect(app.workbench.console.suggestionList).toHaveCount(4);

		// Session 1b - verify autocomplete suggestions
		await triggerAutocompleteInConsole(app, rSession1b);
		await expect(app.workbench.console.suggestionList).toHaveCount(4);

		// Open a new R file
		await runCommand('R: New R File');
		await variables.togglePane('hide');

		// Session 1a - verify autocomplete suggestions
		await triggerAutocompleteInEditor(app, rSession1a, keyboard);
		await editors.expectSuggestionListCount(4);

		// Session 1b - verify autocomplete suggestions
		await retriggerAutocompleteInEditor(app, rSession1b, keyboard);
		await editors.expectSuggestionListCount(4);

		// Session 2 - verify no autocomplete
		await retriggerAutocompleteInEditor(app, rSession2, keyboard);
		await editors.expectSuggestionListCount(0);
	});
});


// Helper functions

async function triggerAutocompleteInConsole(app: Application, session: SessionInfo) {
	await app.workbench.sessions.select(session.id);

	if (session.language === 'Python') {
		await app.workbench.console.pasteCodeToConsole('import pandas as pd');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.typeToConsole('df = pd.Dat', false, 250);
	} else {
		await app.workbench.console.pasteCodeToConsole('library(arrow)');
		await app.workbench.console.sendEnterKey();
		await app.workbench.console.typeToConsole('df2 <- read_p', false, 250);
	}
}

async function triggerAutocompleteInEditor(app: Application, session: SessionInfo, keyboard: Keyboard) {
	const { sessions } = app.workbench;

	await sessions.select(session.id);
	await keyboard.hotKeys(Hotkeys.FIRST_TAB);

	session.language === 'Python'
		? await keyboard.type('df = pd.Dat', { delay: 250 })
		: await keyboard.type('df2 <- read_p', { delay: 250 });
}

async function retriggerAutocompleteInEditor(app: Application, session: SessionInfo, keyboard: Keyboard) {
	const { sessions } = app.workbench;

	await sessions.select(session.id);
	await keyboard.hotKeys(Hotkeys.FIRST_TAB);
	await keyboard.press('Backspace', { delay: 1000 });

	session.language === 'Python'
		? await keyboard.type('t', { delay: 1000 })
		: await keyboard.type('p', { delay: 1000 });
}


