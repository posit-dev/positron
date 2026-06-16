/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { TestPositronConsoleService } from '../../../../services/positronConsole/test/browser/testPositronConsoleService.js';
import { CellExecutionState, ExecutionOutputEvent, ICellOutput } from '../../common/quartoExecutionTypes.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { RuntimeOnlineState, RuntimeOutputKind, LanguageRuntimeSessionLocation, LanguageRuntimeStartupBehavior, LanguageRuntimeSessionMode, ILanguageRuntimeMetadata, RuntimeErrorBehavior, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { QuartoExecutionManager, shouldSkipFirstCommandFinished } from '../../browser/quartoExecutionManager.js';
import { PromptInputState, IPromptInputModel } from '../../../../../platform/terminal/common/capabilities/commandDetection/promptInputModel.js';
import { IQuartoKernelManager } from '../../browser/quartoKernelManager.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { QuartoCodeCell } from '../../common/quartoTypes.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IEphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralState.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { Event } from '../../../../../base/common/event.js';

const TestLanguageRuntimeMetadata: ILanguageRuntimeMetadata = {
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
	startupBehavior: LanguageRuntimeStartupBehavior.Explicit
};

function createSessionMetadata(sessionId: string): IRuntimeSessionMetadata {
	return {
		sessionId,
		createdTimestamp: Date.now(),
		sessionMode: LanguageRuntimeSessionMode.Console,
		notebookUri: undefined,
		startReason: 'Unit Test'
	};
}

describe('shouldSkipFirstCommandFinished', () => {
	it('returns true when state is Input and value is non-empty', () => {
		const model = stubInterface<IPromptInputModel>({ state: PromptInputState.Input, value: 'pending' });
		expect(shouldSkipFirstCommandFinished(model)).toBe(true);
	});
});

describe('QuartoExecutionManager', () => {
	const ctx = createTestContainer().build();
	const logService = new NullLogService();

	let executionManager: QuartoExecutionManager;
	let mockSession: TestLanguageRuntimeSession;
	let mockKernelManager: MockKernelManager;
	let mockDocumentModelService: MockDocumentModelService;
	let mockEditorService: MockEditorService;
	let mockConsoleService: RecordingConsoleService;
	let mockRuntimeSessionService: MockRuntimeSessionService;

	beforeEach(() => {
		// Create mock session
		const metadata = createSessionMetadata('test-session');

		mockSession = new TestLanguageRuntimeSession(metadata, TestLanguageRuntimeMetadata);
		ctx.disposables.add(mockSession);

		// Transition session to ready state so execute works
		mockSession.setRuntimeState(RuntimeState.Ready);

		// Create mock services
		mockKernelManager = ctx.disposables.add(new MockKernelManager(mockSession));
		mockDocumentModelService = new MockDocumentModelService();
		mockEditorService = new MockEditorService();
		const mockEphemeralStateService = new MockEphemeralStateService();
		const mockWorkspaceContextService = new MockWorkspaceContextService();
		mockConsoleService = new RecordingConsoleService();
		mockRuntimeSessionService = new MockRuntimeSessionService();
		const mockTerminalService = new MockTerminalService();

		// Create execution manager
		executionManager = new QuartoExecutionManager(
			asKernelManager(mockKernelManager),
			asDocumentModelService(mockDocumentModelService),
			asEditorService(mockEditorService),
			asEphemeralStateService(mockEphemeralStateService),
			asWorkspaceContextService(mockWorkspaceContextService),
			logService,
			asConsoleService(mockConsoleService),
			asRuntimeSessionService(mockRuntimeSessionService),
			asTerminalService(mockTerminalService),
		);
		ctx.disposables.add(executionManager);
	});

	describe('Execution Options', () => {
		it('uses RuntimeErrorBehavior.Stop by default for inline execution', async () => {
			const documentUri = URI.file('/test-error-default.qmd');
			const cell: QuartoCodeCell = {
				id: 'test-error-default',
				index: 0,
				language: 'python',
				startLine: 1,
				endLine: 3,
				codeStartLine: 2,
				codeEndLine: 2,
				label: undefined,
				options: '',
				contentHash: 'error-default',
			};

			let executedErrorBehavior: RuntimeErrorBehavior | undefined;
			const executionListener = executionManager.onDidExecuteCode(event => {
				executedErrorBehavior = event.errorBehavior;
			});
			ctx.disposables.add(executionListener);

			const executionPromise = executionManager.executeCell(documentUri, cell);
			const executionId = await mockKernelManager.waitForExecution();
			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});
			await executionPromise;

			expect(executedErrorBehavior).toBe(RuntimeErrorBehavior.Stop);
		});

		it('uses RuntimeErrorBehavior.Continue for console execution when error: false', async () => {
			const documentUri = URI.file('/test-console-error-false.qmd');
			const cell: QuartoCodeCell = {
				id: 'test-console-error-false',
				index: 0,
				language: 'r',
				startLine: 1,
				endLine: 4,
				codeStartLine: 2,
				codeEndLine: 3,
				label: undefined,
				options: '',
				contentHash: 'console-error-false',
			};

			const mockModel = new MockQuartoDocumentModel(
				[cell],
				['```{r}', '#| error: false', 'x <- 1', '```']
			);
			mockDocumentModelService.setMockModel(mockModel);
			mockEditorService.getValueInRangeCallback = () => '#| error: false\nx <- 1';
			mockRuntimeSessionService.setConsoleSessionForLanguage('r', mockSession);

			const executionPromise = executionManager.executeCell(documentUri, cell);
			const executionId = await mockConsoleService.waitForExecution();

			expect(mockConsoleService.lastErrorBehavior).toBe(RuntimeErrorBehavior.Continue);

			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});
			await executionPromise;
		});
	});

	describe('Output Handling', () => {
		it('filters out text/plain when text/html is present (DataFrame case)', async () => {
			// This test verifies that when both text/html and text/plain are returned
			// (as happens with pandas DataFrames), only text/html is included in output.
			const documentUri = URI.file('/test.qmd');
			const cell: QuartoCodeCell = {
				id: 'test-cell-df',
				index: 0,
				language: 'python',
				startLine: 1,
				endLine: 4,
				codeStartLine: 2,
				codeEndLine: 3,
				label: undefined,
				options: '',
				contentHash: 'df123',
			};

			const outputsReceived: ICellOutput[] = [];
			const outputListener = executionManager.onDidReceiveOutput((event: ExecutionOutputEvent) => {
				outputsReceived.push(event.output);
			});
			ctx.disposables.add(outputListener);

			// Start execution
			const executionPromise = executionManager.executeCell(documentUri, cell);

			// Wait for the session's execute to fire (TestLanguageRuntimeSession
			// transitions to Busy then fires onDidExecute on subsequent ticks)
			const executionId = await mockKernelManager.waitForExecution();
			expect(executionId, 'Should have captured execution ID').toBeDefined();

			// Simulate a pandas DataFrame output that includes both HTML and plain text
			// This is what pandas sends: both a rich HTML table and a plain text fallback
			mockSession.receiveOutputMessage({
				parent_id: executionId,
				kind: RuntimeOutputKind.Text,
				data: {
					'text/html': '<table><tr><th>col1</th><th>col2</th></tr><tr><td>1</td><td>2</td></tr></table>',
					'text/plain': '   col1  col2\n0     1     2'
				},
			});

			// Complete execution
			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});

			await executionPromise;

			// VERIFY: Only ONE output should be received (the HTML version)
			expect(outputsReceived.length, 'Should receive exactly one output').toBe(1);

			// The output should contain HTML but NOT text/plain
			const output = outputsReceived[0];
			const mimeTypes = output.items.map(item => item.mime);

			expect(mimeTypes, 'Output should include text/html').toContain('text/html');
			expect(mimeTypes, 'Output should NOT include text/plain when HTML is present').not.toContain('text/plain');

			// Verify the HTML content is correct
			const htmlItem = output.items.find(item => item.mime === 'text/html');
			expect(htmlItem, 'Should have HTML item').toBeDefined();
			expect(htmlItem!.data, 'HTML should contain table').toContain('<table>');
		});

		it('filters out text/plain when image is present', async () => {
			// This test verifies that when both an image and text/plain are returned
			// (as happens with matplotlib plots), only the image is included in output.
			const documentUri = URI.file('/test.qmd');
			const cell: QuartoCodeCell = {
				id: 'test-cell-img',
				index: 0,
				language: 'python',
				startLine: 1,
				endLine: 4,
				codeStartLine: 2,
				codeEndLine: 3,
				label: undefined,
				options: '',
				contentHash: 'img123',
			};

			const outputsReceived: ICellOutput[] = [];
			const outputListener = executionManager.onDidReceiveOutput((event: ExecutionOutputEvent) => {
				outputsReceived.push(event.output);
			});
			ctx.disposables.add(outputListener);

			// Start execution
			const executionPromise = executionManager.executeCell(documentUri, cell);

			// Wait for the session's execute to fire
			const executionId = await mockKernelManager.waitForExecution();
			expect(executionId, 'Should have captured execution ID').toBeDefined();

			// Simulate a matplotlib plot output that includes both image and plain text
			mockSession.receiveOutputMessage({
				parent_id: executionId,
				kind: RuntimeOutputKind.PlotWidget,
				data: {
					'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
					'text/plain': '<Figure size 640x480 with 1 Axes>'
				},
			});

			// Complete execution
			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});

			await executionPromise;

			// VERIFY: Only ONE output should be received
			expect(outputsReceived.length, 'Should receive exactly one output').toBe(1);

			// The output should contain image/png but NOT text/plain
			const output = outputsReceived[0];
			const mimeTypes = output.items.map(item => item.mime);

			expect(mimeTypes, 'Output should include image/png').toContain('image/png');
			expect(mimeTypes, 'Output should NOT include text/plain when image is present').not.toContain('text/plain');
		});

		it('keeps text/plain when no rich format is present', async () => {
			// This test verifies that text/plain is kept when it's the only format available
			const documentUri = URI.file('/test.qmd');
			const cell: QuartoCodeCell = {
				id: 'test-cell-plain',
				index: 0,
				language: 'python',
				startLine: 1,
				endLine: 4,
				codeStartLine: 2,
				codeEndLine: 3,
				label: undefined,
				options: '',
				contentHash: 'plain123',
			};

			const outputsReceived: ICellOutput[] = [];
			const outputListener = executionManager.onDidReceiveOutput((event: ExecutionOutputEvent) => {
				outputsReceived.push(event.output);
			});
			ctx.disposables.add(outputListener);

			// Start execution
			const executionPromise = executionManager.executeCell(documentUri, cell);

			// Wait for the session's execute to fire
			const executionId = await mockKernelManager.waitForExecution();
			expect(executionId, 'Should have captured execution ID').toBeDefined();

			// Simulate a simple text-only result (like from "2 + 3")
			mockSession.receiveResultMessage({
				parent_id: executionId,
				kind: RuntimeOutputKind.Text,
				data: {
					'text/plain': '5'
				},
			});

			// Complete execution
			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});

			await executionPromise;

			// VERIFY: Output should be received with text/plain
			expect(outputsReceived.length, 'Should receive exactly one output').toBe(1);

			const output = outputsReceived[0];
			const mimeTypes = output.items.map(item => item.mime);

			expect(mimeTypes, 'Output should include text/plain when no rich format is available').toContain('text/plain');
			expect(output.items[0].data, 'Should have correct text content').toBe('5');
		});

		it('handles both stream output and execute_result output', async () => {
			const documentUri = URI.file('/test.qmd');
			const cell: QuartoCodeCell = {
				id: 'test-cell-1',
				index: 0,
				language: 'python',
				startLine: 1,
				endLine: 4,
				codeStartLine: 2,
				codeEndLine: 3,
				label: undefined,
				options: '',
				contentHash: 'abc123',
			};

			const outputsReceived: ICellOutput[] = [];
			const outputListener = executionManager.onDidReceiveOutput((event: ExecutionOutputEvent) => {
				outputsReceived.push(event.output);
			});
			ctx.disposables.add(outputListener);

			// Start execution (but don't await yet)
			const executionPromise = executionManager.executeCell(documentUri, cell);

			// Wait for the session's execute to fire
			const executionId = await mockKernelManager.waitForExecution();
			expect(executionId, 'Should have captured execution ID').toBeDefined();

			// Simulate stdout stream output (like from print("hello"))
			mockSession.receiveStreamMessage({
				parent_id: executionId,
				name: 'stdout',
				text: 'hello\n',
			});

			// Simulate execute_result output (like from "2 + 3")
			mockSession.receiveResultMessage({
				parent_id: executionId,
				kind: RuntimeOutputKind.Text,
				data: { 'text/plain': '5' },
			});

			// Complete execution
			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});

			await executionPromise;

			// VERIFY BOTH OUTPUTS WERE CAPTURED
			// The first output should be the stream output (stdout)
			expect(outputsReceived.length, 'Should receive at least one output (stream)').toBeGreaterThanOrEqual(1);
			expect(outputsReceived[0].items[0].mime).toBe('application/vnd.code.notebook.stdout');
			expect(outputsReceived[0].items[0].data).toBe('hello\n');

			// The second output should be the execute_result output
			expect(outputsReceived.length, 'Should receive two outputs (stream + execute_result)').toBe(2);
			expect(outputsReceived[1].items[0].mime).toBe('text/plain');
			expect(outputsReceived[1].items[0].data).toBe('5');
		});
	});

	describe('Cell Line Number Tracking', () => {
		it('uses current cell line numbers when document is edited before execution', async () => {
			// This test verifies the bug where cell line numbers become stale
			// when the document is edited between queueing and execution.
			//
			// Bug reproduction scenario:
			// 1. Open a document with a cell at lines 5-7 (code at line 6)
			// 2. Edit the document, adding 3 lines before the cell
			// 3. Document re-parses: cell is now at lines 8-10 (code at line 9)
			// 4. User runs the cell (from UI, which may still have old cell object)
			//
			// The bug: When the execution manager receives a cell object with OLD
			// line numbers (6), it would use those stale numbers instead of looking
			// up the current line numbers from the re-parsed document model.
			//
			// The fix: The execution manager looks up the cell by ID from the
			// current document model to get fresh line numbers.

			const documentUri = URI.file('/test-line-tracking.qmd');

			// The CURRENT cell state in the model (after re-parsing)
			// has updated line numbers
			const currentCell: QuartoCodeCell = {
				id: '0-abc12345-unlabeled',
				index: 0,
				language: 'python',
				startLine: 8,
				endLine: 10,
				codeStartLine: 9,  // Current correct line
				codeEndLine: 9,
				label: undefined,
				options: '',
				contentHash: 'abc12345',
			};

			// Create mock model with CURRENT state (already re-parsed)
			const editedDocumentLines = [
				'---', 'title: test', '---', '',
				'Some added text',       // Line 5 - new
				'More added text',       // Line 6 - new (where old code was!)
				'Even more text',        // Line 7 - new
				'```{python}',           // Line 8 - cell start (moved)
				'x = 1',                 // Line 9 - code (moved)
				'```',                   // Line 10 - cell end (moved)
			];
			const mockModel = new MockQuartoDocumentModel([currentCell], editedDocumentLines);
			const mockDocumentModelService = new MockDocumentModelService();
			mockDocumentModelService.setMockModel(mockModel);

			// Track what range getValueInRange is called with to verify
			// the execution manager uses the CURRENT line numbers
			let capturedRange: { startLineNumber: number; endLineNumber: number } | undefined;
			const trackingEditorService = new MockEditorService();
			trackingEditorService.getValueInRangeCallback = (range: unknown) => {
				const r = range as { startLineNumber: number; endLineNumber: number };
				capturedRange = { startLineNumber: r.startLineNumber, endLineNumber: r.endLineNumber };
				return 'x = 1';
			};

			// Create execution manager with the mock model service
			const executionManagerWithMock = new QuartoExecutionManager(
				asKernelManager(mockKernelManager),
				asDocumentModelService(mockDocumentModelService),
				asEditorService(trackingEditorService),
				asEphemeralStateService(new MockEphemeralStateService()),
				asWorkspaceContextService(new MockWorkspaceContextService()),
				logService,
				new TestPositronConsoleService(),
				asRuntimeSessionService(new MockRuntimeSessionService()),
				asTerminalService(new MockTerminalService()),
			);
			ctx.disposables.add(executionManagerWithMock);

			// Create a STALE cell object (simulating what UI might pass)
			// This has the OLD line numbers from before the document edit
			const staleCellObject: QuartoCodeCell = {
				id: '0-abc12345-unlabeled',  // Same ID - this is key!
				index: 0,
				language: 'python',
				startLine: 5,       // OLD line numbers
				endLine: 7,
				codeStartLine: 6,   // OLD - would read wrong content!
				codeEndLine: 6,
				label: undefined,
				options: '',
				contentHash: 'abc12345',
			};

			// Start execution with the STALE cell object
			// The fix should look up by ID and use current line numbers
			const executionPromise = executionManagerWithMock.executeCell(documentUri, staleCellObject);

			// Wait for the session's execute to fire
			const executionId = await mockKernelManager.waitForExecution();

			// Complete the execution
			if (executionId) {
				mockSession.receiveStateMessage({
					parent_id: executionId,
					state: RuntimeOnlineState.Idle,
				});
			}

			await executionPromise;

			// VERIFY: The execution manager should have looked up the cell by ID
			// and used the CURRENT line numbers (9), not the stale ones (6).
			// We check the range passed to getValueInRange, which reflects the
			// code range built from getCellById's result.
			expect(capturedRange, 'Should have called getValueInRange with a range').toBeDefined();
			expect(capturedRange!.startLineNumber, 'Should use CURRENT cell line numbers (9), not stale ones (6)').toBe(9);
			expect(capturedRange!.endLineNumber, 'Should use CURRENT cell end line (9), not stale one (6)').toBe(9);
		});
	});

	describe('Queued Range Cleanup', () => {
		it('clears queued ranges after executeInlineCells with option lines (#12662)', async () => {
			// When executeInlineCells receives a range that includes Jupyter
			// code options (e.g. #| label: test), the range is added to the
			// queue including the option lines. But during execution, the
			// effective range (excluding options) was used for removal,
			// causing a mismatch and leaving stale queued decorations.

			const documentUri = URI.file('/test-options-queued.qmd');
			const cell: QuartoCodeCell = {
				id: 'test-options',
				index: 0,
				language: 'python',
				startLine: 1,
				endLine: 5,
				codeStartLine: 2,
				codeEndLine: 4,
				label: undefined,
				options: '',
				contentHash: 'options123',
			};

			const documentLines = [
				'```{python}',      // Line 1 - fence
				'#| label: test',   // Line 2 - option line (codeStartLine)
				'x = 1',            // Line 3 - actual code
				'print(x)',         // Line 4 - actual code (codeEndLine)
				'```',              // Line 5 - fence
			];

			const mockModel = new MockQuartoDocumentModel([cell], documentLines);
			const localMockDocumentModelService = new MockDocumentModelService();
			localMockDocumentModelService.setMockModel(mockModel);

			const localMockEditorService = new MockEditorService();
			localMockEditorService.getValueInRangeCallback = (range: unknown) => {
				const r = range as { startLineNumber: number; endLineNumber: number };
				return documentLines.slice(r.startLineNumber - 1, r.endLineNumber).join('\n');
			};

			const localExecutionManager = new QuartoExecutionManager(
				asKernelManager(mockKernelManager),
				asDocumentModelService(localMockDocumentModelService),
				asEditorService(localMockEditorService),
				asEphemeralStateService(new MockEphemeralStateService()),
				asWorkspaceContextService(new MockWorkspaceContextService()),
				logService,
				new TestPositronConsoleService(),
				asRuntimeSessionService(new MockRuntimeSessionService()),
				asTerminalService(new MockTerminalService()),
			);
			ctx.disposables.add(localExecutionManager);

			// Execute via executeInlineCells with range that includes option lines
			const codeRange = new Range(2, 1, 4, 100);

			const executionPromise = localExecutionManager.executeInlineCells(
				documentUri, [codeRange]
			);

			// Wait for execution to start (the cell transitions
			// from Queued to Running as the async setup completes)
			const executionId = await mockKernelManager.waitForExecution();

			// Complete execution
			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});

			await executionPromise;

			// Queued ranges should be empty after execution completes
			const queuedRanges = localExecutionManager.getQueuedRanges('test-options');
			expect(queuedRanges.length, 'Queued ranges should be empty after execution completes').toBe(0);

			// State should not be Queued
			expect(localExecutionManager.getExecutionState('test-options'), 'Cell should not be in Queued state after execution').not.toBe(CellExecutionState.Queued);
		});
	});

	describe('Cell Options as Execution Metadata', () => {
		// Helper that runs a cell with the given chunk options and returns the
		// executionMetadata argument the kernel session received. Optionally
		// passes external per-range metadata to executeInlineCells -- the same
		// channel the Quarto extension uses to inject viewport sizing.
		async function runCellAndCaptureMetadata(
			documentLines: string[],
			cellRange: Range,
			externalMetadata?: Record<string, unknown>[],
		) {
			const documentUri = URI.file('/test-cell-metadata.qmd');
			const cell: QuartoCodeCell = {
				id: 'cell-metadata',
				index: 0,
				language: 'python',
				startLine: 1,
				endLine: documentLines.length,
				codeStartLine: 2,
				codeEndLine: documentLines.length - 1,
				label: undefined,
				options: '',
				contentHash: 'metadata123',
			};
			const mockModel = new MockQuartoDocumentModel([cell], documentLines);
			mockDocumentModelService.setMockModel(mockModel);
			mockEditorService.getValueInRangeCallback = (range: unknown) => {
				const r = range as { startLineNumber: number; endLineNumber: number };
				return documentLines.slice(r.startLineNumber - 1, r.endLineNumber).join('\n');
			};

			const executeSpy = vi.spyOn(mockSession, 'execute');

			const executionPromise = executionManager.executeInlineCells(documentUri, [cellRange], undefined, externalMetadata);
			const executionId = await mockKernelManager.waitForExecution();
			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});
			await executionPromise;

			expect(executeSpy).toHaveBeenCalledOnce();
			// session.execute(code, id, mode, errorBehavior, _attribution, executionMetadata)
			return executeSpy.mock.calls[0][5] as Record<string, unknown> | undefined;
		}

		it('passes fig-width and fig-height from chunk options to session.execute', async () => {
			const metadata = await runCellAndCaptureMetadata(
				[
					'```{python}',          // 1: fence
					'#| fig-width: 4',      // 2: option
					'#| fig-height: 3',     // 3: option
					'plot()',               // 4: code
					'```',                  // 5: fence
				],
				new Range(2, 1, 4, 100)
			);

			expect(metadata).toBeDefined();
			expect(metadata!['fig-width']).toBe(4);
			expect(metadata!['fig-height']).toBe(3);
		});

		it('passes a non-execution option like label as metadata', async () => {
			const metadata = await runCellAndCaptureMetadata(
				[
					'```{python}',
					'#| label: my-cell',
					'x = 1',
					'```',
				],
				new Range(2, 1, 3, 100)
			);

			expect(metadata).toBeDefined();
			expect(metadata!['label']).toBe('my-cell');
		});

		it('does not include execution-control options (eval, error) in metadata', async () => {
			// `eval` and `error` are EXECUTION_OPTION_KEYS handled separately;
			// they should not leak into the metadata payload sent to the kernel.
			const metadata = await runCellAndCaptureMetadata(
				[
					'```{python}',
					'#| eval: true',
					'#| error: false',
					'#| fig-width: 5',
					'x = 1',
					'```',
				],
				new Range(2, 1, 5, 100)
			);

			expect(metadata).toBeDefined();
			expect(metadata!['fig-width']).toBe(5);
			expect(metadata!['eval']).toBeUndefined();
			expect(metadata!['error']).toBeUndefined();
		});

		it('passes undefined when there are no chunk options and no layout metadata', async () => {
			const metadata = await runCellAndCaptureMetadata(
				[
					'```{python}',
					'x = 1',
					'```',
				],
				new Range(2, 1, 2, 100)
			);

			// With no cell options and no editor (so no layoutMetadata),
			// session.execute should receive undefined for executionMetadata.
			expect(metadata).toBeUndefined();
		});

		it('cell options take precedence over external metadata on key conflicts', async () => {
			// Both cell and external set fig-width; cell should win.
			// External-only keys flow through to the kernel.
			const metadata = await runCellAndCaptureMetadata(
				[
					'```{python}',
					'#| fig-width: 4',
					'plot()',
					'```',
				],
				new Range(2, 1, 3, 100),
				[{ 'fig-width': 99, 'output_pixel_ratio': 2 }],
			);

			expect(metadata).toBeDefined();
			expect(metadata!['fig-width'], 'cell value should win').toBe(4);
			expect(metadata!['output_pixel_ratio'], 'external-only key should pass through').toBe(2);
		});
	});
});

// Mock implementations
//
// These mocks are Quarto-specific and don't have shared test counterparts.
// For shared test services, we use existing infrastructure:
// - TestLanguageRuntimeSession (from runtimeSession/test)
// - TestPositronConsoleService (from positronConsole/test)

/**
 * Mock kernel manager that returns the TestLanguageRuntimeSession directly.
 *
 * Uses the session's built-in onDidExecute event to capture execution IDs,
 * rather than wrapping the session with a fragile object spread.
 */
class MockKernelManager extends Disposable {
	lastExecutionId?: string;
	private _executionResolve?: (id: string) => void;

	constructor(private readonly _session: TestLanguageRuntimeSession) {
		super();
		// Listen for executions via the session's built-in test event
		this._register(_session.onDidExecute(id => {
			this.lastExecutionId = id;
			this._executionResolve?.(id);
		}));
	}

	/**
	 * Wait for the next execution to start. Returns the execution ID.
	 */
	waitForExecution(timeoutMs = 5000): Promise<string> {
		if (this.lastExecutionId) {
			const id = this.lastExecutionId;
			this.lastExecutionId = undefined;
			return Promise.resolve(id);
		}
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				this._executionResolve = undefined;
				reject(new Error('Timed out waiting for execution'));
			}, timeoutMs);
			this._executionResolve = (id: string) => {
				clearTimeout(timer);
				this._executionResolve = undefined;
				resolve(id);
			};
		});
	}

	async ensureKernelForDocument(_documentUri: URI, _token?: CancellationToken): Promise<ILanguageRuntimeSession | undefined> {
		// Return the real TestLanguageRuntimeSession directly.
		// Its execute() method will fire onDidExecute with the execution ID.
		return this._session;
	}

	interruptKernelForDocument(_documentUri: URI): void {
		// No-op
	}
}

function asKernelManager(mock: MockKernelManager): IQuartoKernelManager {
	return stubInterface<IQuartoKernelManager>({
		ensureKernelForDocument: mock.ensureKernelForDocument.bind(mock),
		interruptKernelForDocument: mock.interruptKernelForDocument.bind(mock),
	});
}

class RecordingConsoleService extends TestPositronConsoleService {
	lastErrorBehavior: RuntimeErrorBehavior | undefined;
	lastExecutionId: string | undefined;
	private _executionResolve?: (id: string) => void;

	override async executeCode(...args: Parameters<TestPositronConsoleService['executeCode']>): Promise<string> {
		this.lastErrorBehavior = args[7];
		this.lastExecutionId = args[8];
		if (this.lastExecutionId) {
			this._executionResolve?.(this.lastExecutionId);
		}
		return super.executeCode(...args);
	}

	waitForExecution(timeoutMs = 5000): Promise<string> {
		if (this.lastExecutionId) {
			return Promise.resolve(this.lastExecutionId);
		}
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				this._executionResolve = undefined;
				reject(new Error('Timed out waiting for console execution'));
			}, timeoutMs);
			this._executionResolve = (id: string) => {
				clearTimeout(timer);
				this._executionResolve = undefined;
				resolve(id);
			};
		});
	}
}

class MockDocumentModelService {
	private _mockModel: MockQuartoDocumentModel | undefined;

	setMockModel(model: MockQuartoDocumentModel): void {
		this._mockModel = model;
	}

	getModel(_textModel: unknown): unknown {
		if (this._mockModel) {
			return this._mockModel;
		}
		// Default mock that returns cell unchanged (for tests that don't need line tracking)
		return {
			primaryLanguage: 'python',
			cells: [] as QuartoCodeCell[],
			getCellById(id: string): QuartoCodeCell | undefined {
				return {
					id,
					index: 0,
					language: 'python',
					startLine: 1,
					endLine: 4,
					codeStartLine: 2,
					codeEndLine: 3,
					label: undefined,
					options: '',
					contentHash: 'test',
				};
			}
		};
	}
}

function asDocumentModelService(mock: MockDocumentModelService): IQuartoDocumentModelService {
	return stubInterface<IQuartoDocumentModelService>({
		// Cast: the mock's getModel returns a structurally-compatible model
		// but isn't typed as the full QuartoDocumentModel because we don't
		// want to depend on its concrete type in the mock layer.
		getModel: mock.getModel.bind(mock) as IQuartoDocumentModelService['getModel'],
	});
}

/**
 * Mock Quarto document model that allows simulating document edits
 * by updating cell line numbers.
 */
class MockQuartoDocumentModel {
	private _cells: Map<string, QuartoCodeCell> = new Map();
	private _documentLines: string[] = [];
	readonly primaryLanguage = 'python';

	get cells(): QuartoCodeCell[] {
		return Array.from(this._cells.values());
	}

	constructor(cells: QuartoCodeCell[], documentLines: string[]) {
		for (const cell of cells) {
			this._cells.set(cell.id, cell);
		}
		this._documentLines = documentLines;
	}

	getCellById(id: string): QuartoCodeCell | undefined {
		return this._cells.get(id);
	}

	getCellCode(cell: QuartoCodeCell): string {
		const lines: string[] = [];
		for (let i = cell.codeStartLine; i <= cell.codeEndLine; i++) {
			// documentLines is 0-indexed, cell lines are 1-indexed
			if (i - 1 >= 0 && i - 1 < this._documentLines.length) {
				lines.push(this._documentLines[i - 1]);
			}
		}
		return lines.join('\n');
	}
}

class MockEditorService {
	getValueInRangeCallback?: (range: unknown) => string;

	findEditors(_resource: unknown): unknown[] {
		const self = this;
		return [{
			editor: {
				resolve: async () => ({
					textEditorModel: {
						getValue: () => 'test code',
						getLineContent: (_line: number) => 'test code',
						getLineMaxColumn: (_line: number) => 100,
						getValueInRange: (range: unknown) => {
							if (self.getValueInRangeCallback) {
								return self.getValueInRangeCallback(range);
							}
							return 'test code';
						},
					}
				})
			}
		}];
	}
}

function asEditorService(mock: MockEditorService): IEditorService {
	return stubInterface<IEditorService>({
		// Cast: findEditors has overloaded signatures that we can't easily
		// model in the mock; we narrow at the boundary.
		findEditors: mock.findEditors.bind(mock) as IEditorService['findEditors'],
		// activeTextEditorControl is a getter, not a method -- production
		// reads it to derive layout metadata when an editor is active. The
		// existing tests don't activate an editor, so undefined is correct.
		activeTextEditorControl: undefined,
	});
}

class MockEphemeralStateService {
	async setItem(_key: string, _value: unknown): Promise<void> {
		// No-op: production calls setItem for queue persistence; tests don't read it back.
	}
}

function asEphemeralStateService(mock: MockEphemeralStateService): IEphemeralStateService {
	return stubInterface<IEphemeralStateService>({
		setItem: mock.setItem.bind(mock),
	});
}

class MockWorkspaceContextService {
	getWorkspace(): unknown {
		return { id: 'test-workspace' };
	}
}

function asWorkspaceContextService(mock: MockWorkspaceContextService): IWorkspaceContextService {
	return stubInterface<IWorkspaceContextService>({
		getWorkspace: mock.getWorkspace.bind(mock) as IWorkspaceContextService['getWorkspace'],
	});
}

class MockRuntimeSessionService {
	private readonly _consoleSessions = new Map<string, ILanguageRuntimeSession>();

	getSession(_sessionId: string): ILanguageRuntimeSession | undefined {
		return undefined;
	}

	getConsoleSessionForLanguage(languageId: string): ILanguageRuntimeSession | undefined {
		return this._consoleSessions.get(languageId);
	}

	setConsoleSessionForLanguage(languageId: string, session: ILanguageRuntimeSession): void {
		this._consoleSessions.set(languageId, session);
	}
}

function asRuntimeSessionService(mock: MockRuntimeSessionService): IRuntimeSessionService {
	return stubInterface<IRuntimeSessionService>({
		getConsoleSessionForLanguage: mock.getConsoleSessionForLanguage.bind(mock),
		// Production subscribes to onDidStartRuntime but never fires it from
		// the test side; Event.None is the documented no-op event.
		onDidStartRuntime: Event.None,
	});
}

class MockTerminalService {
	async getActiveOrCreateInstance() {
		return undefined;
	}
}

function asTerminalService(mock: MockTerminalService): ITerminalService {
	return stubInterface<ITerminalService>({
		// Cast: the mock's return type is loose; production expects an
		// ITerminalInstance. None of the cell-metadata tests hit shell
		// languages, so this branch is never exercised in this file.
		getActiveOrCreateInstance: mock.getActiveOrCreateInstance.bind(mock) as ITerminalService['getActiveOrCreateInstance'],
	});
}

function asConsoleService(mock: RecordingConsoleService): IPositronConsoleService {
	// RecordingConsoleService extends TestPositronConsoleService which already
	// implements the full IPositronConsoleService interface; no adapter needed.
	return mock;
}
