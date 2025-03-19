/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, pythonSession, pythonSessionAlt, rSession, rSessionAlt, SessionInfo } from '../../infra/index.js';
import { test, tags } from '../_test.setup';

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
	tag: [tags.WEB, tags.WIN, tags.CONSOLE, tags.SESSIONS, tags.EDITOR]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Python - Verify autocomplete suggestions in Console and Editor',
		{ annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6839' }] },
		async function ({ app, runCommand }) {
			const { sessions, variables, editors, console } = app.workbench;

			pythonSession1a.id = await sessions.launch(pythonSession1a);
			pythonSession1b.id = await sessions.launch(pythonSession1b);
			pythonSession2.id = await sessions.launch(pythonSession2);
			await variables.togglePane('hide');

			// Session 1a - trigger and verify console autocomplete
			await triggerAutocompleteInConsole(app, pythonSession1a);
			await console.expectSuggestionListCount(8);

			// Session 1b - trigger and verify console autocomplete
			await triggerAutocompleteInConsole(app, pythonSession1b);
			await console.expectSuggestionListCount(8);

			// Session 2 - trigger and verify no console autocomplete
			await sessions.select(pythonSession2.id);
			await console.typeToConsole('pd.Dat', false, 250);
			await console.expectSuggestionListCount(0);

			// Open a new Python file
			await runCommand('Python: New Python File');

			// Session 1a - trigger and verify editor autocomplete
			await triggerAutocompleteInEditor({ app, session: pythonSession1a, retrigger: false });
			await editors.expectSuggestionListCount(5);  // issue 6839, should be 8

			// Session 1b - retrigger and verify editor autocomplete
			await triggerAutocompleteInEditor({ app, session: pythonSession1b, retrigger: true });
			await editors.expectSuggestionListCount(5); // issue 6839, should be 8

			// Session 2 - retrigger and verify no editor autocomplete
			await triggerAutocompleteInEditor({ app, session: pythonSession2, retrigger: true });
			await editors.expectSuggestionListCount(0);
		});

	test('R - Verify autocomplete suggestions in Console and Editor', async function ({ app, runCommand }) {
		const { sessions, variables, editors, console } = app.workbench;

		rSession1a.id = await sessions.reuseIdleSessionIfExists(rSession1a);
		rSession1b.id = await sessions.launch(rSession1b);
		rSession2.id = await sessions.launch(rSession2);
		await variables.togglePane('hide');

		// Session 1a - verify console autocomplete
		await triggerAutocompleteInConsole(app, rSession1a);
		await console.expectSuggestionListCount(4);

		// Session 1b - verify console autocomplete
		await triggerAutocompleteInConsole(app, rSession1b);
		await console.expectSuggestionListCount(4);

		// Session 2 - verify no console autocomplete
		await sessions.select(rSession2.id);
		await console.typeToConsole('read_p', false, 250);
		await console.expectSuggestionListCount(0);

		// Open a new R file
		await runCommand('R: New R File');

		// Session 1a - trigger and verify editor autocomplete
		await triggerAutocompleteInEditor({ app, session: rSession1a, retrigger: false });
		await editors.expectSuggestionListCount(4);

		// Session 1b - retrigger and verify editor autocomplete
		await triggerAutocompleteInEditor({ app, session: rSession1b, retrigger: true });
		await editors.expectSuggestionListCount(4);

		// Session 2 - retrigger verify no editor autocomplete
		await triggerAutocompleteInEditor({ app, session: rSession2, retrigger: true });
		await editors.expectSuggestionListCount(0);
	});
});


// Helper functions

async function triggerAutocompleteInConsole(app: Application, session: SessionInfo) {
	const { sessions, console } = app.workbench;

	await sessions.select(session.id);

	if (session.language === 'Python') {
		await console.pasteCodeToConsole('import pandas as pd', true);
		await console.typeToConsole('pd.Dat', false, 250);
	} else {
		await console.pasteCodeToConsole('library(arrow)', true);
		await console.typeToConsole('read_p', false, 250);
	}
}

async function triggerAutocompleteInEditor({ app, session, retrigger = false }: {
	app: Application;
	session: SessionInfo;
	retrigger?: boolean;
}) {
	const { sessions } = app.workbench;
	const keyboard = app.keyboard;

	await sessions.select(session.id);
	await keyboard.hotKeys.firstTab();

	if (retrigger) {
		await keyboard.press('Backspace', { delay: 1000 });
		await keyboard.type(session.language === 'Python' ? 't' : 'p', { delay: 1000 });
	} else {
		await keyboard.type(
			session.language === 'Python' ? 'pd.Dat' : 'read_p',
			{ delay: 250 }
		);
	}
}
