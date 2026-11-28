/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { Application } from '../../infra';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
});

const PROVIDER = 'anthropic';
const ORIGINAL = 'x <- 1\ny <- 2\n';
const EDITED = 'x <- 100\ny <- 2\n';

// Not tagged for web: the edits are only reviewable once the Posit Assistant
// build that Positron bundles tracks them.
test.describe('Posit Assistant: Edit Review', {
	tag: [tags.ASSISTANT],
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		// Update before signing in; see posit-assistant.test.ts.
		await app.workbench.positAssistant.checkForDevBuildUpdate(settings, app.workbench.quickaccess);
		await app.workbench.providerManager.loginModelProvider(PROVIDER);
		await app.workbench.quickaccess.runCommand('workbench.action.fullSizedSidebar');
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	/** Have the assistant edit a new copy of the fixture, and wait for the edit to be pending. */
	async function editWithAssistant(app: Application, openFile: (filePath: string) => Promise<void>, fileName: string): Promise<string> {
		const filePath = path.join(app.workspacePathOrFolder, fileName);
		await fs.promises.writeFile(filePath, ORIGINAL);
		await openFile(fileName);

		const assistant = app.workbench.positAssistant;
		await assistant.open();
		await assistant.waitForReady();
		await assistant.startNewConversation();
		await assistant.selectProviderModel(PROVIDER);
		await assistant.sendMessage(
			`In the file ${fileName}, change the line \`x <- 1\` to \`x <- 100\` using your edit tool. Make no other changes and do not run any code.`,
			false, { newConversation: false });
		await assistant.waitForResponseCompleteAllowingTools();

		// The edit is on disk while it is pending.
		await app.workbench.editReview.expectPendingEdits();
		await expect.poll(() => fs.promises.readFile(filePath, 'utf8')).toBe(EDITED);
		return filePath;
	}

	test('Keeping an edit made by the assistant leaves it in the file', async function ({ app, openFile, cleanup }) {
		const fileName = 'edit-review-keep.R';
		try {
			const filePath = await editWithAssistant(app, openFile, fileName);

			await app.workbench.editReview.keep();

			await app.workbench.editReview.expectNoPendingEdits();
			expect(await fs.promises.readFile(filePath, 'utf8')).toBe(EDITED);
		} finally {
			await cleanup.removeTestFiles([fileName]);
		}
	});

	test('Undoing an edit made by the assistant restores the file', async function ({ app, openFile, cleanup }) {
		const fileName = 'edit-review-undo.R';
		try {
			const filePath = await editWithAssistant(app, openFile, fileName);

			await app.workbench.editReview.undo();

			await app.workbench.editReview.expectNoPendingEdits();
			await expect.poll(() => fs.promises.readFile(filePath, 'utf8')).toBe(ORIGINAL);
		} finally {
			await cleanup.removeTestFiles([fileName]);
		}
	});
});
