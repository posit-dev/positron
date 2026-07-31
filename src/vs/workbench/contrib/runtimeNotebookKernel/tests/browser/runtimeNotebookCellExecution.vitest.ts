/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeErrorBehavior } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionMetadata } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { CellKind, NotebookCellExecutionState } from '../../../notebook/common/notebookCommon.js';
import { CellExecutionUpdateType } from '../../../notebook/common/notebookExecutionService.js';
import { ICellExecuteUpdate, ICellExecutionComplete, INotebookCellExecution } from '../../../notebook/common/notebookExecutionStateService.js';
import { createTestNotebookEditor } from '../../../notebook/test/browser/testNotebookEditor.js';
import { RuntimeNotebookCellExecution } from '../../browser/runtimeNotebookCellExecution.js';

const testRuntimeMetadata: ILanguageRuntimeMetadata = {
	base64EncodedIconSvg: '',
	extensionId: new ExtensionIdentifier('test.extension'),
	extraRuntimeData: {},
	languageId: 'python',
	runtimeId: 'test.runtime',
	runtimeName: 'Test Runtime',
	languageName: 'Python',
	languageVersion: '3.10.0',
	runtimePath: '/path/to/runtime',
	runtimeShortName: 'Test',
	runtimeSource: 'test',
	runtimeVersion: '1.0.0',
	sessionLocation: LanguageRuntimeSessionLocation.Machine,
	startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
};

const testSessionMetadata: IRuntimeSessionMetadata = {
	sessionId: 'test-session',
	createdTimestamp: Date.now(),
	sessionMode: LanguageRuntimeSessionMode.Notebook,
	notebookUri: undefined,
	startReason: 'Unit Test',
};

const STDOUT_MIME = 'application/vnd.code.notebook.stdout';

/** An INotebookCellExecution with vi.fn() methods for assertion. */
class TestCellExecution implements INotebookCellExecution {
	constructor(
		readonly notebook: URI,
		readonly cellHandle: number,
	) { }

	readonly state = NotebookCellExecutionState.Unconfirmed;

	readonly didPause: boolean = false;
	readonly isPaused: boolean = false;

	confirm = vi.fn();
	update = vi.fn<(updates: ICellExecuteUpdate[]) => void>();
	complete = vi.fn<(complete: ICellExecutionComplete) => void>();
}

describe('RuntimeNotebookCellExecution - clear_output', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();
	let session: TestLanguageRuntimeSession;
	let notebookDocument: NotebookTextModel;
	let cell: NotebookCellTextModel;
	let cellExecution: TestCellExecution;
	let execution: RuntimeNotebookCellExecution;

	beforeEach(() => {
		session = ctx.disposables.add(new TestLanguageRuntimeSession(testSessionMetadata, testRuntimeMetadata));

		// Create a test notebook document. The second cell starts with an
		// existing stdout output so tests can exercise the stream-merging path
		// (TestCellExecution.update doesn't apply edits to the model, so the
		// fixture output stays in place throughout a test).
		notebookDocument = createTestNotebookEditor(
			ctx.instantiationService,
			ctx.disposables.add(new DisposableStore()),
			[
				['print(x)', 'python', CellKind.Code, [], {}],
				['print(y)', 'python', CellKind.Code, [{
					outputId: 'existing-stream-output',
					outputs: [{ data: VSBuffer.fromString('previous'), mime: STDOUT_MIME }],
				}], {}],
			],
		).viewModel.notebookDocument;
	});

	/** Create a RuntimeNotebookCellExecution for the cell at the given index. */
	function startExecution(cellIndex = 0) {
		cell = notebookDocument.cells[cellIndex];
		cellExecution = new TestCellExecution(notebookDocument.uri, cell.handle);
		execution = ctx.disposables.add(ctx.instantiationService.createInstance(
			RuntimeNotebookCellExecution,
			session,
			cellExecution,
			cell,
			notebookDocument,
			RuntimeErrorBehavior.Stop,
		));
		// The constructor issues one update (start timer + clear outputs);
		// ignore it so tests assert on message-driven updates only.
		cellExecution.update.mockClear();
	}

	/** The output-related updates received by the cell execution, flattened. */
	function outputUpdates(): ICellExecuteUpdate[] {
		return cellExecution.update.mock.calls
			.flatMap(call => call[0])
			.filter(update => update.editType !== CellExecutionUpdateType.ExecutionState);
	}

	it('clears outputs immediately on clear_output(wait=False)', () => {
		startExecution();

		session.receiveClearOutputMessage({ parent_id: execution.id, wait: false });

		expect(outputUpdates()).toEqual([{
			editType: CellExecutionUpdateType.Output,
			cellHandle: cell.handle,
			outputs: [],
		}]);
	});

	it('defers the clear until the next output on clear_output(wait=True)', () => {
		startExecution();

		session.receiveClearOutputMessage({ parent_id: execution.id, wait: true });

		// No update until the next output arrives.
		expect(outputUpdates()).toEqual([]);

		// The next output replaces the cell's outputs instead of appending.
		session.receiveOutputMessage({ parent_id: execution.id, data: { 'text/plain': 'Epoch 1/5' } });
		expect(outputUpdates()).toEqual([{
			editType: CellExecutionUpdateType.Output,
			cellHandle: cell.handle,
			append: false,
			outputs: [expect.objectContaining({
				outputs: [{ data: VSBuffer.fromString('Epoch 1/5'), mime: 'text/plain' }],
			})],
		}]);

		// The pending clear is consumed: a subsequent output appends again.
		session.receiveOutputMessage({ parent_id: execution.id, data: { 'text/plain': 'Epoch 1/5 - loss: 0.5' } });
		expect(outputUpdates()).toHaveLength(2);
		expect(outputUpdates()[1]).toEqual(expect.objectContaining({
			editType: CellExecutionUpdateType.Output,
			append: true,
		}));
	});

	it('defers the clear for execute_result outputs', () => {
		startExecution();

		session.receiveClearOutputMessage({ parent_id: execution.id, wait: true });
		session.receiveResultMessage({ parent_id: execution.id, data: { 'text/plain': 'result' } });

		expect(outputUpdates()).toEqual([expect.objectContaining({
			editType: CellExecutionUpdateType.Output,
			append: false,
		})]);
	});

	it('replaces instead of merging into the previous stream output after clear_output(wait=True)', () => {
		// Use the cell with an existing stdout output in the model.
		startExecution(1);

		// Without a pending clear, a stream message merges into the existing
		// stdout output (the baseline behavior).
		session.receiveStreamMessage({ parent_id: execution.id, name: 'stdout', text: 'merged' });
		expect(outputUpdates()).toEqual([{
			editType: CellExecutionUpdateType.OutputItems,
			append: true,
			outputId: 'existing-stream-output',
			items: [{ data: VSBuffer.fromString('merged'), mime: STDOUT_MIME }],
		}]);

		// With a pending clear, the stream message replaces the cell's outputs.
		session.receiveClearOutputMessage({ parent_id: execution.id, wait: true });
		session.receiveStreamMessage({ parent_id: execution.id, name: 'stdout', text: 'replaced' });
		expect(outputUpdates()).toHaveLength(2);
		expect(outputUpdates()[1]).toEqual(expect.objectContaining({
			editType: CellExecutionUpdateType.Output,
			cellHandle: cell.handle,
			append: false,
			outputs: [expect.objectContaining({
				outputs: [{ data: VSBuffer.fromString('replaced'), mime: STDOUT_MIME }],
			})],
		}));
	});

	it('replaces the outputs with an error output after clear_output(wait=True)', () => {
		startExecution();

		// The execution ends with an error; consume the rejection.
		execution.promise.catch(() => { });

		session.receiveClearOutputMessage({ parent_id: execution.id, wait: true });
		session.receiveErrorMessage({ parent_id: execution.id, name: 'TestError', message: 'oops' });

		expect(outputUpdates()).toEqual([expect.objectContaining({
			editType: CellExecutionUpdateType.Output,
			cellHandle: cell.handle,
			append: false,
		})]);
	});

	it('clear_output(wait=False) cancels a pending deferred clear', () => {
		startExecution();

		session.receiveClearOutputMessage({ parent_id: execution.id, wait: true });
		session.receiveClearOutputMessage({ parent_id: execution.id, wait: false });

		// The immediate clear happened.
		expect(outputUpdates()).toEqual([{
			editType: CellExecutionUpdateType.Output,
			cellHandle: cell.handle,
			outputs: [],
		}]);

		// The next output appends normally; the deferred clear was consumed.
		session.receiveOutputMessage({ parent_id: execution.id, data: { 'text/plain': 'output' } });
		expect(outputUpdates()[1]).toEqual(expect.objectContaining({
			editType: CellExecutionUpdateType.Output,
			append: true,
		}));
	});

	it('multiple clear_output(wait=True) calls collapse into a single replace', () => {
		startExecution();

		session.receiveClearOutputMessage({ parent_id: execution.id, wait: true });
		session.receiveClearOutputMessage({ parent_id: execution.id, wait: true });
		session.receiveOutputMessage({ parent_id: execution.id, data: { 'text/plain': 'output' } });

		expect(outputUpdates()).toEqual([expect.objectContaining({
			editType: CellExecutionUpdateType.Output,
			append: false,
		})]);
	});

	it('simulates a training loop: each iteration replaces the previous output', () => {
		startExecution();

		// for epoch in range(3): clear_output(wait=True); display(f'Epoch {epoch}')
		for (let epoch = 0; epoch < 3; epoch++) {
			session.receiveClearOutputMessage({ parent_id: execution.id, wait: true });
			session.receiveOutputMessage({ parent_id: execution.id, data: { 'text/plain': `Epoch ${epoch + 1}/3` } });
		}

		// Every display replaces the previous output; nothing accumulates.
		const updates = outputUpdates();
		expect(updates).toHaveLength(3);
		for (const update of updates) {
			expect(update).toEqual(expect.objectContaining({
				editType: CellExecutionUpdateType.Output,
				append: false,
			}));
		}
	});

	it('ignores clear_output messages from other executions', () => {
		startExecution();

		session.receiveClearOutputMessage({ parent_id: 'other-execution', wait: false });
		expect(outputUpdates()).toEqual([]);

		// A pending clear from another execution must not affect this one.
		session.receiveClearOutputMessage({ parent_id: 'other-execution', wait: true });
		session.receiveOutputMessage({ parent_id: execution.id, data: { 'text/plain': 'output' } });
		expect(outputUpdates()).toEqual([expect.objectContaining({
			editType: CellExecutionUpdateType.Output,
			append: true,
		})]);
	});
});
