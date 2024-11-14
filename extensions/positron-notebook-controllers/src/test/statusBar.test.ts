/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { strict as assert } from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { registerExecutionInfoStatusBar, SHOW_EXECUTION_INFO_SECTION } from '../statusBar';
import { NotebookControllerManager } from '../notebookControllerManager';
import { DidEndExecutionEvent, DidStartExecutionEvent } from '../notebookController';

suite('statusBar', () => {
	let disposables: vscode.Disposable[];
	let onDidStartExecution: vscode.EventEmitter<DidStartExecutionEvent>;
	let onDidEndExecution: vscode.EventEmitter<DidEndExecutionEvent>;
	let manager: NotebookControllerManager;
	let item: sinon.SinonSpiedInstance<vscode.StatusBarItem> | undefined;
	let cell: vscode.NotebookCell;

	setup(() => {
		disposables = [];

		// Create a mock notebook controller manager.
		onDidStartExecution = new vscode.EventEmitter();
		onDidEndExecution = new vscode.EventEmitter();
		disposables.push(onDidStartExecution, onDidEndExecution);
		manager = {
			onDidStartExecution: onDidStartExecution.event,
			onDidEndExecution: onDidEndExecution.event,
		} as NotebookControllerManager;

		// Stub vscode.window.createStatusBarItem to spy on the created item.
		item = undefined;
		const originalCreateStatusBarItem = vscode.window.createStatusBarItem;
		sinon.stub(vscode.window, 'createStatusBarItem').callsFake((...args) => {
			assert.equal(item, undefined);
			const result = originalCreateStatusBarItem(...args);
			item = sinon.spy(result);
			return result;
		});

		// Create a mock notebook cell.
		cell = {} as vscode.NotebookCell;
	});

	function createStatusBarItem() {
		registerExecutionInfoStatusBar(disposables, manager);
		assert.ok(item, 'Status bar item not created');
		return item;
	}

	teardown(async () => {
		disposables.forEach(d => d.dispose());
		sinon.restore();
		await setShowExecutionInfo(undefined);
	});

	test('initially hidden', async () => {
		await setShowExecutionInfo(false);

		const item = createStatusBarItem();

		sinon.assert.calledOnce(item.hide);
		assert.equal(item.text, '');
	});

	test('initially shown', async () => {
		await setShowExecutionInfo(true);

		const item = createStatusBarItem();

		sinon.assert.calledOnce(item.show);
		assert.equal(item.text, '');
	});

	test('show on config change', async () => {
		await setShowExecutionInfo(false);

		const item = createStatusBarItem();
		item.show.resetHistory();

		await setShowExecutionInfo(true);

		sinon.assert.calledOnce(item.show);
	});

	test('hide on config change', async () => {
		await setShowExecutionInfo(true);

		const item = createStatusBarItem();
		item.hide.resetHistory();

		await setShowExecutionInfo(false);

		sinon.assert.calledOnce(item.hide);
	});

	test('update on execution start', async () => {
		await setShowExecutionInfo(true);

		const item = createStatusBarItem();

		onDidStartExecution.fire({ cells: [cell] });
		assert.equal(item.text, 'Executing 1 cell');

		onDidStartExecution.fire({ cells: [cell, cell] });
		assert.equal(item.text, 'Executing 2 cells');
	});

	test('update on execution end', async () => {
		await setShowExecutionInfo(true);

		const item = createStatusBarItem();

		onDidEndExecution.fire({ cells: [cell], duration: 1234 });
		assert.equal(item.text, 'Executed 1 cell in 1 second');

		onDidEndExecution.fire({ cells: [cell, cell], duration: 12500 });
		assert.equal(item.text, 'Executed 2 cells in 13 seconds');
	});
});

function setShowExecutionInfo(value: boolean | undefined) {
	return vscode.workspace.getConfiguration().update(SHOW_EXECUTION_INFO_SECTION, value);
}
