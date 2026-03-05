/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

interface LanguageConfig {
	session: 'r' | 'python';
	fileName: string;
	fileContent: string;
	runFileCommand: string;
	tags: string[];
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const countLines = (content: string) => content.split('\n').filter(line => line.trim()).length;

const languageConfigs: LanguageConfig[] = [
	{
		session: 'r',
		fileName: 'plot-attribution-test.R',
		fileContent: 'plot(1:10)\n',
		tags: [tags.ARK],
		runFileCommand: 'r.sourceCurrentFile',
	},
	{
		session: 'python',
		fileName: 'plot-attribution-test.py',
		fileContent: [
			'import matplotlib.pyplot as plt',
			'plt.plot([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])',
			'plt.show()',
			''
		].join('\n'),
		tags: [],
		runFileCommand: 'python.execInConsole',
	},
];

for (const config of languageConfigs) {
	test.describe(`Plot File Attribution`, { tag: [tags.PLOTS, ...config.tags] }, () => {

		test.beforeEach(async function ({ app, sessions }) {
			const filePath = path.join(app.workspacePathOrFolder, config.fileName);
			fs.writeFileSync(filePath, config.fileContent);

			await sessions.start(config.session);
		});

		test.afterEach(async function ({ app, hotKeys }) {
			await hotKeys.closeAllEditors();
			await hotKeys.clearPlots();
			await app.workbench.plots.waitForNoPlots({ timeout: 3000 });
		});

		test.afterAll(async function ({ cleanup }) {
			await cleanup.removeTestFiles([config.fileName]);
		});

		test(`${capitalize(config.session)} - Plot origin shows source file after line execution`, async function ({ app, openFile, hotKeys }) {
			const { plots, editors } = app.workbench;

			// Open the file and run each line of code to generate a plot
			await openFile(config.fileName);
			for (let i = 0; i < countLines(config.fileContent); i++) {
				await hotKeys.runLineOfCode();
			}

			// Wait for the plot to appear and verify the origin button
			await plots.waitForCurrentPlot();
			await plots.expectOriginButtonVisible();
			await plots.expectOriginButtonContain(config.fileName);

			// Close the editor and click the origin button to verify it opens the correct file
			await hotKeys.closeAllEditors();
			await plots.clickOriginFileButton();
			await editors.verifyTab(config.fileName, { isVisible: true, isSelected: true });
		});

		test(`${capitalize(config.session)} - Plot origin shows source file after run file command`, async function ({ app, openFile, runCommand, hotKeys }) {
			const { plots, editors } = app.workbench;

			// Open the file and run the command to execute the entire file
			await openFile(config.fileName);
			await runCommand(config.runFileCommand);

			// Wait for the plot to appear and verify the origin button
			await plots.waitForCurrentPlot();
			await plots.expectOriginButtonVisible();
			await plots.expectOriginButtonContain(config.fileName);

			// Close the editor and click the origin button to verify it opens the correct file
			await hotKeys.closeAllEditors();
			await plots.clickOriginFileButton();
			await editors.verifyTab(config.fileName, { isVisible: true, isSelected: true });
		});
	});
}
