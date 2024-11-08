/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { strict as assert } from 'assert';
import * as vscode from 'vscode';

export class TestNotebookCellExecution implements vscode.NotebookCellExecution {
	token: vscode.CancellationToken;
	executionOrder: number | undefined;

	private _started = false;
	private _startTime?: number;
	private _ended = false;
	private _success: boolean | undefined;
	private _endTime?: number;

	constructor(
		public readonly cell: vscode.NotebookCell,
	) {
		const tokenSource = new vscode.CancellationTokenSource();
		this.token = tokenSource.token;
	}

	start(startTime?: number): void {
		assert.ok(!this._started, 'Execution was already started.');
		this._started = true;
		this._startTime = startTime;
	}

	end(success: boolean | undefined, endTime?: number): void {
		assert.ok(this._started, 'Execution was not started.');
		assert.ok(!this._ended, 'Execution was already ended.');
		if (endTime) {
			assert.ok(this._startTime && endTime >= this._startTime, 'End time is before start time.');
		}
		this._ended = true;
		this._success = success;
		this._endTime = endTime;
	}

	async clearOutput(_cell?: vscode.NotebookCell): Promise<void> {
		// Do nothing.
	}

	async replaceOutput(_out: vscode.NotebookCellOutput | readonly vscode.NotebookCellOutput[], _cell?: vscode.NotebookCell): Promise<void> {
		// Do nothing.
	}

	async appendOutput(_out: vscode.NotebookCellOutput | readonly vscode.NotebookCellOutput[], _cell?: vscode.NotebookCell): Promise<void> {
		// Do nothing.
	}

	async replaceOutputItems(_items: vscode.NotebookCellOutputItem | readonly vscode.NotebookCellOutputItem[], _output: vscode.NotebookCellOutput): Promise<void> {
		// Do nothing.
	}

	async appendOutputItems(_items: vscode.NotebookCellOutputItem | readonly vscode.NotebookCellOutputItem[], _output: vscode.NotebookCellOutput): Promise<void> {
		// Do nothing.
	}

	// Test helpers.

	get startTime() {
		return this._startTime;
	}

	get endTime() {
		return this._endTime;
	}

	assertDidStart() {
		assert.ok(this._started, `Expected cell ${this.cell.index} to start`);
	}

	assertDidNotStart() {
		assert.ok(!this._started, `Expected cell ${this.cell.index} to not start`);
	}

	assertDidEnd() {
		this.assertDidStart();
		assert.ok(this._ended, `Expected cell ${this.cell.index} to end`);
	}

	assertDidEndSuccessfully() {
		this.assertDidEnd();
		assert.ok(this._success, `Expected cell ${this.cell.index} to end successfully`);
	}

	assertDidEndUnsuccessfully() {
		this.assertDidEnd();
		assert.ok(!this._success, `Expected cell ${this.cell.index} to end unsuccessfully`);
	}

	assertDidExecuteBefore(other: TestNotebookCellExecution) {
		this.assertDidEnd();
		other.assertDidEnd();
		assert.ok(this._endTime, `Expected cell ${this.cell.index} to have an end time`);
		assert.ok(other._startTime, `Expected cell ${other.cell.index} to have a start time`);
		assert.ok(this._endTime <= other._startTime, `Expected cell ${this.cell.index} to execute before cell ${other.cell.index}: ${this._endTime} <= ${other._startTime}`);
	}
}
