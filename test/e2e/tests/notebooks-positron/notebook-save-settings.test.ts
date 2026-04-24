/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import { expect, tags } from '../_test.setup.js';
import { test } from './_test.setup.js';
import { PositronNotebooks } from '../../pages/notebooksPositron.js';

test.use({
	suiteId: __filename
});

async function createNotebookWithOutput(notebooksPositron: PositronNotebooks) {
	await test.step('Create notebook and execute a cell', async () => {
		await notebooksPositron.createNewNotebook();
		await notebooksPositron.expectCellCountToBe(1);
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.addCodeToCell(0, 'print("hello world")', { run: true });
		await notebooksPositron.expectOutputAtIndex(0, ['hello world']);
	});
}

async function readJson(filePath: string) {
	const content = await fs.promises.readFile(filePath, 'utf-8');
	return JSON.parse(content);
}

test.describe('Positron Notebooks: Save Settings', {
	tag: [tags.WIN, tags.POSITRON_NOTEBOOKS]
}, () => {

	let savedFilePath: string;

	test.beforeEach(async function ({ app }) {
		// Create a random file name that the notebook will be saved to.
		const fileName = `test-save-outputs-${Math.random().toString(36).substring(7)}.ipynb`;
		savedFilePath = path.join(app.workspacePathOrFolder, fileName);
	});

	test.afterEach(async function () {
		if (savedFilePath && fs.existsSync(savedFilePath)) {
			fs.unlinkSync(savedFilePath);
		}
	});

	test('notebook.save.outputs=false removes outputs on save', async function ({ app, settings, saveFileAs }) {
		await settings.set({ 'notebook.save.outputs': false });
		await createNotebookWithOutput(app.workbench.notebooksPositron);
		await saveFileAs(savedFilePath);

		await expect(async () => {
			const content = await readJson(savedFilePath);
			for (const cell of content.cells) {
				if (cell.cell_type === 'code') {
					expect(cell.outputs, 'code cell outputs should be empty').toHaveLength(0);
				}
			}
		}).toPass({ timeout: 5000 });
	});

	test('notebook.save.outputs=true preserves outputs on save', async function ({ app, settings, saveFileAs }) {
		await settings.set({ 'notebook.save.outputs': true });
		await createNotebookWithOutput(app.workbench.notebooksPositron);
		await saveFileAs(savedFilePath);

		await expect(async () => {
			const content = await readJson(savedFilePath);
			const codeCell = content.cells.find((c: any) => c.cell_type === 'code');
			expect(codeCell.outputs.length, 'code cell should have outputs').toBeGreaterThan(0);
		}).toPass({ timeout: 5000 });
	});

	test('notebook.save.executionCounts=false removes execution counts on save', async function ({ app, settings, saveFileAs }) {
		await settings.set({ 'notebook.save.executionCounts': false });
		await createNotebookWithOutput(app.workbench.notebooksPositron);
		await saveFileAs(savedFilePath);

		await expect(async () => {
			const content = await readJson(savedFilePath);
			for (const cell of content.cells) {
				if (cell.cell_type === 'code') {
					expect(cell.execution_count, 'execution_count should be null').toBeNull();
				}
			}
		}).toPass({ timeout: 5000 });
	});

	test('notebook.save.executionCounts=true preserves execution counts on save', async function ({ app, settings, saveFileAs }) {
		await settings.set({ 'notebook.save.executionCounts': true });
		await createNotebookWithOutput(app.workbench.notebooksPositron);
		await saveFileAs(savedFilePath);

		await expect(async () => {
			const content = await readJson(savedFilePath);
			const codeCell = content.cells.find((c: any) => c.cell_type === 'code');
			expect(codeCell.execution_count, 'execution_count should be a number').toBeGreaterThan(0);
		}).toPass({ timeout: 5000 });
	});
});
