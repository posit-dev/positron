/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import { expect, tags } from '../_test.setup.js';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Save Settings', {
	tag: [tags.WIN, tags.POSITRON_NOTEBOOKS]
}, () => {

	let savedFilePath: string;

	test.afterEach(async function () {
		if (savedFilePath && fs.existsSync(savedFilePath)) {
			fs.unlinkSync(savedFilePath);
		}
	});

	test('notebook.saveOutputs=false removes outputs on save', async function ({ app, settings, saveFileAs }) {
		const { notebooksPositron } = app.workbench;

		await settings.set({ 'notebook.saveOutputs': false });

		await test.step('Create notebook and execute a cell', async () => {
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'print("hello world")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['hello world']);
		});

		await test.step('Save the notebook', async () => {
			const fileName = `test-save-outputs-${Math.random().toString(36).substring(7)}.ipynb`;
			savedFilePath = path.join(app.workspacePathOrFolder, fileName);
			await saveFileAs(savedFilePath);
		});

		await test.step('Verify outputs are removed from saved file', async () => {
			const content = JSON.parse(fs.readFileSync(savedFilePath, 'utf-8'));
			for (const cell of content.cells) {
				if (cell.cell_type === 'code') {
					expect(cell.outputs, 'code cell outputs should be empty').toHaveLength(0);
				}
			}
		});
	});

	test('notebook.saveOutputs=true preserves outputs on save', async function ({ app, settings, saveFileAs }) {
		const { notebooksPositron } = app.workbench;

		await settings.set({ 'notebook.saveOutputs': true });

		await test.step('Create notebook and execute a cell', async () => {
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'print("hello world")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['hello world']);
		});

		await test.step('Save the notebook', async () => {
			const fileName = `test-save-outputs-${Math.random().toString(36).substring(7)}.ipynb`;
			savedFilePath = path.join(app.workspacePathOrFolder, fileName);
			await saveFileAs(savedFilePath);
		});

		await test.step('Verify outputs are preserved in saved file', async () => {
			const content = JSON.parse(fs.readFileSync(savedFilePath, 'utf-8'));
			const codeCell = content.cells.find((c: any) => c.cell_type === 'code');
			expect(codeCell.outputs.length, 'code cell should have outputs').toBeGreaterThan(0);
		});
	});

	test('notebook.saveExecutionCounts=false removes execution counts on save', async function ({ app, settings, saveFileAs }) {
		const { notebooksPositron } = app.workbench;

		await settings.set({ 'notebook.saveExecutionCounts': false });

		await test.step('Create notebook and execute a cell', async () => {
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'print("hello")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['hello']);
		});

		await test.step('Save the notebook', async () => {
			const fileName = `test-save-exec-count-${Math.random().toString(36).substring(7)}.ipynb`;
			savedFilePath = path.join(app.workspacePathOrFolder, fileName);
			await saveFileAs(savedFilePath);
		});

		await test.step('Verify execution_count is null in saved file', async () => {
			const content = JSON.parse(fs.readFileSync(savedFilePath, 'utf-8'));
			for (const cell of content.cells) {
				if (cell.cell_type === 'code') {
					expect(cell.execution_count, 'execution_count should be null').toBeNull();
				}
			}
		});
	});

	test('notebook.saveExecutionCounts=true preserves execution counts on save', async function ({ app, settings, saveFileAs }) {
		const { notebooksPositron } = app.workbench;

		await settings.set({ 'notebook.saveExecutionCounts': true });

		await test.step('Create notebook and execute a cell', async () => {
			await notebooksPositron.createNewNotebook();
			await notebooksPositron.expectCellCountToBe(1);
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'print("hello")', { run: true });
			await notebooksPositron.expectOutputAtIndex(0, ['hello']);
		});

		await test.step('Save the notebook', async () => {
			const fileName = `test-save-exec-count-${Math.random().toString(36).substring(7)}.ipynb`;
			savedFilePath = path.join(app.workspacePathOrFolder, fileName);
			await saveFileAs(savedFilePath);
		});

		await test.step('Verify execution_count is preserved in saved file', async () => {
			const content = JSON.parse(fs.readFileSync(savedFilePath, 'utf-8'));
			const codeCell = content.cells.find((c: any) => c.cell_type === 'code');
			expect(codeCell.execution_count, 'execution_count should be a number').toBeGreaterThan(0);
		});
	});
});
