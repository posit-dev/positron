/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, SessionMetaData } from '../../infra/index.js';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Autocomplete', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE, tags.SESSIONS, tags.EDITOR, tags.CRITICAL]
}, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Verify autocomplete suggestions in Console and Editor', async function ({ app, runCommand, sessions, hotKeys }) {
		const { editors, console } = app.positron;

		const [pySession1, pySession2, pyAltSession] = await sessions.start(['python', 'python', 'pythonAlt']);
		await hotKeys.closeSecondarySidebar();

		// Session 1 - trigger and verify console autocomplete
		await sessions.select(pySession1.id);
		await triggerAutocompleteInConsole(app, pySession1);
		await console.expectSuggestionListCount(1);

		// Session 2 - trigger and verify console autocomplete
		await sessions.select(pySession2.id);
		await triggerAutocompleteInConsole(app, pySession2);
		await console.expectSuggestionListCount(1);

		// Alt Session 1 - trigger and verify no console autocomplete
		await sessions.select(pyAltSession.id);
		await console.typeToConsole('pd.DataF', false, 250);
		await console.expectSuggestionListCount(0);

		// Open a new Python file
		await runCommand('Python: New Python File');

		// Session 1 - trigger and verify editor autocomplete
		await triggerAutocompleteInEditor({ app, session: pySession1, retrigger: false });
		await editors.expectSuggestionListCount(1);

		// Session 2 - retrigger and verify editor autocomplete
		await triggerAutocompleteInEditor({ app, session: pySession2, retrigger: true });
		await editors.expectSuggestionListCount(1);

		// Alt Session 1 - retrigger and verify no editor autocomplete
		await triggerAutocompleteInEditor({ app, session: pyAltSession, retrigger: true });
		await editors.expectSuggestionListCount(0);
	});

	test('Python - Verify autocomplete suggestions (LSP is alive) after restart', async function ({ app, hotKeys, sessions }) {
		const { console } = app.positron;

		const [pySession, pyAltSession] = await sessions.start(['python', 'pythonAlt']);
		await hotKeys.closeSecondarySidebar();

		// Session 1 - verify console autocomplete
		await sessions.select(pySession.id);
		await console.clearInput();
		await console.typeToConsole('import os', true, 0);
		await console.typeToConsole('os.path.', false, 250);
		await console.expectSuggestionListToContain('abspath, def abspath(path)');

		// Session 2 - verify console autocomplete
		await sessions.select(pyAltSession.id);
		await console.clearInput();
		await console.typeToConsole('import os', true, 0);
		await console.typeToConsole('os.path.', false, 250);
		await console.expectSuggestionListToContain('abspath, def abspath(path)');
		await console.clearInput();

		// Session 1 - restart and verify console autocomplete
		await sessions.restart(pySession.id);
		await console.clearInput();
		await console.typeToConsole('import os', true, 0);
		await console.expectSuggestionListToContain('abspath, def abspath(path)');

		// Session 2 - verify console autocomplete
		await sessions.select(pyAltSession.id);
		await console.clearInput();
		await console.expectSuggestionListToContain('abspath, def abspath(path)');
	});

	test('R - Verify autocomplete suggestions in Console and Editor', {
		tag: [tags.ARK]
	}, async function ({ app, runCommand, sessions, hotKeys }) {
		const { editors, console } = app.positron;

		const [rSession1, rSession2, rSessionAlt] = await sessions.start(['r', 'r', 'rAlt']);
		await hotKeys.closeSecondarySidebar();

		// Session 1 - verify console autocomplete
		await sessions.select(rSession1.id);
		await triggerAutocompleteInConsole(app, rSession1);
		await console.expectSuggestionListCount(4);

		// Session 2 - verify console autocomplete
		await sessions.select(rSession2.id);
		await triggerAutocompleteInConsole(app, rSession2);
		await console.expectSuggestionListCount(4);

		// Alt Session 1 - verify no console autocomplete
		await sessions.select(rSessionAlt.id);
		await console.typeToConsole('read_p', false, 250);
		await console.expectSuggestionListCount(0);

		// Open a new R file
		await runCommand('R: New R File');

		// Session 1 - trigger and verify editor autocomplete
		await triggerAutocompleteInEditor({ app, session: rSession1, retrigger: false });
		await editors.expectSuggestionListCount(4);

		// Session 2 - retrigger and verify editor autocomplete
		await triggerAutocompleteInEditor({ app, session: rSession2, retrigger: true });
		await editors.expectSuggestionListCount(4);

		// Alt Session 1 - retrigger verify no editor autocomplete
		await triggerAutocompleteInEditor({ app, session: rSessionAlt, retrigger: true });
		await editors.expectSuggestionListCount(0);
	});

	test('R - Verify autocomplete suggestions (LSP is alive) after restart', {
		tag: [tags.ARK]
	}, async function ({ app, sessions, hotKeys }) {
		const { console } = app.positron;

		const [rSession, rSessionAlt] = await sessions.start(['r', 'rAlt']);
		await hotKeys.closeSecondarySidebar();

		// Session 1 - verify console autocomplete
		await sessions.select(rSession.id);
		await console.typeToConsole('base::abb');
		await console.expectSuggestionListToContain('abbreviate, {base}');

		// Session 2 - verify console autocomplete
		await sessions.select(rSessionAlt.id);
		await console.typeToConsole('base::abb');
		await console.expectSuggestionListToContain('abbreviate, {base}');

		// Session 1 - restart and verify console autocomplete
		await sessions.restart(rSession.id);
		await console.clearInput();
		await console.typeToConsole('base::abb');
		await console.expectSuggestionListToContain('abbreviate, {base}');

		// Session 2 - verify console autocomplete
		await sessions.select(rSessionAlt.id);
		await console.clearInput();
		await console.typeToConsole('base::abb');
		await console.expectSuggestionListToContain('abbreviate, {base}');
	});
});


// Helper functions

async function triggerAutocompleteInConsole(app: Application, session: SessionMetaData) {
	const { console, sessions } = app.positron;

	if (session.name.includes('Python')) {
		await console.typeToConsole('import pandas as pd', true, 0);
		await sessions.expectAllSessionsToBeReady();
		await console.typeToConsole('pd.DataF', false, 250);
	} else {
		await console.typeToConsole('library(arrow)', true, 0);
		await sessions.expectAllSessionsToBeReady();
		await console.typeToConsole('read_p', false, 250);
	}
}

async function triggerAutocompleteInEditor({ app, session, retrigger = false }: {
	app: Application;
	session: SessionMetaData;
	retrigger?: boolean;
}) {
	const { sessions, hotKeys } = app.positron;
	const keyboard = app.code.driver.page.keyboard;

	await sessions.select(session.id);
	await hotKeys.firstTab();

	if (retrigger) {
		const triggerText = session.name.includes('Python') ? 'pd.DataF' : 'read_p';
		for (let i = 0; i < triggerText.length; i++) {
			await keyboard.press('Backspace', { delay: 250 });
		}
		await keyboard.type(triggerText);
	} else {
		await keyboard.type(
			session.name.includes('Python') ? 'pd.DataF' : 'read_p',
			{ delay: 250 }
		);
	}
}
