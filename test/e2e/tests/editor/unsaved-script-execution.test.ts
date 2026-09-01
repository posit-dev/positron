/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

interface LanguageConfig {
	session: 'r' | 'python';
	newFileCommand: string;
	code: string;
	marker: string;
	// The scratch file path as echoed to the console: a quoted literal beginning
	// right after the opening quote with ".positron-", i.e. relative to the
	// working directory (the workspace root here) rather than an absolute path.
	relativePath: RegExp;
	tags: string[];
}

// The marker is assembled at runtime so it is not present verbatim in the
// source text. R's toolbar run echoes the sourced lines to the console, so a
// marker that appeared literally in the code would show up twice.
const languageConfigs: LanguageConfig[] = [
	{
		session: 'r',
		newFileCommand: 'r.createNewFile',
		code: 'cat(paste0("SCRATCH", "_R_RAN"), "\\n")',
		marker: 'SCRATCH_R_RAN',
		relativePath: /"\.positron-untitled-\d+\.R"/,
		tags: [tags.ARK],
	},
	{
		session: 'python',
		newFileCommand: 'python.createNewFile',
		code: 'print("SCRATCH" + "_PY_RAN")',
		marker: 'SCRATCH_PY_RAN',
		relativePath: /"\.positron-untitled-\d+\.py"/,
		tags: [],
	},
];

for (const config of languageConfigs) {
	test.describe('Run Unsaved Script', { tag: [tags.WEB, tags.WIN, tags.EDITOR, tags.CONSOLE, ...config.tags] }, () => {

		test.beforeEach(async ({ sessions }) => {
			await sessions.start(config.session);
		});

		test.afterEach(async ({ hotKeys }) => {
			await hotKeys.closeAllEditors();
		});

		test(`${config.session === 'r' ? 'R' : 'Python'} - runs an untitled script without a save prompt`, async ({ app, runCommand }) => {
			const { editor, editors, console: consolePane } = app.workbench;

			await test.step('Create a new untitled script with code', async () => {
				await runCommand(config.newFileCommand);
				await editor.type(config.code);
			});

			await test.step('Run the whole file via the editor toolbar button', async () => {
				await editor.playButton.click();
			});

			// The scratch file is run by a path relative to the working
			// directory, not an ugly absolute path.
			await consolePane.waitForConsoleContents(config.relativePath);

			// The code actually ran: its marker shows up in the console.
			await consolePane.waitForConsoleContents(config.marker);

			// No save prompt appeared: the buffer is still an unsaved, untitled
			// editor. Had a save dialog blocked the run, the marker above would
			// never have appeared.
			await editors.waitForActiveTab(/Untitled-\d+/, true);
		});
	});
}
