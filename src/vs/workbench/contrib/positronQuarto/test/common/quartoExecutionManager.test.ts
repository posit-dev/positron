/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { TestPositronConsoleService } from '../../../../services/positronConsole/test/browser/testPositronConsoleService.js';
import { ExecutionOutputEvent, ICellOutput } from '../../common/quartoExecutionTypes.js';
import { RuntimeOnlineState, RuntimeOutputKind, LanguageRuntimeSessionLocation, LanguageRuntimeStartupBehavior, LanguageRuntimeSessionMode, ILanguageRuntimeMetadata, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { QuartoExecutionManager } from '../../browser/quartoExecutionManager.js';
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

const TestLanguageRuntimeMetadata: ILanguageRuntimeMetadata = {
	base64EncodedIconSvg: '',
	extensionId: { value: 'test.extension' } as ExtensionIdentifier,
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

suite('QuartoExecutionManager', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const logService = new NullLogService();

	let executionManager: QuartoExecutionManager;
	let mockSession: TestLanguageRuntimeSession;
	let mockKernelManager: MockKernelManager;

	setup(() => {
		// Create mock session
		const metadata = createSessionMetadata('test-session');

		mockSession = new TestLanguageRuntimeSession(metadata, TestLanguageRuntimeMetadata);
		disposables.add(mockSession);

		// Transition session to ready state so execute works
		mockSession.setRuntimeState(RuntimeState.Ready);

		// Create mock services
		mockKernelManager = disposables.add(new MockKernelManager(mockSession));
		const mockDocumentModelService = new MockDocumentModelService();
		const mockEditorService = new MockEditorService();
		const mockEphemeralStateService = new MockEphemeralStateService();
		const mockWorkspaceContextService = new MockWorkspaceContextService();
		const mockConsoleService = new TestPositronConsoleService();
		const mockRuntimeSessionService = new MockRuntimeSessionService();
		const mockTerminalService = new MockTerminalService();

		// Create execution manager
		executionManager = new QuartoExecutionManager(
			mockKernelManager as unknown as IQuartoKernelManager,
			mockDocumentModelService as unknown as IQuartoDocumentModelService,
			mockEditorService as unknown as IEditorService,
			mockEphemeralStateService as unknown as IEphemeralStateService,
			mockWorkspaceContextService as unknown as IWorkspaceContextService,
			logService,
			mockConsoleService as unknown as IPositronConsoleService,
			mockRuntimeSessionService as unknown as IRuntimeSessionService,
			mockTerminalService as unknown as ITerminalService,
		);
		disposables.add(executionManager);
	});

	suite('Output Handling', () => {
		test('filters out text/plain when text/html is present (DataFrame case)', async () => {
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
			disposables.add(outputListener);

			// Start execution
			const executionPromise = executionManager.executeCell(documentUri, cell);

			// Wait for the session's execute to fire (TestLanguageRuntimeSession
			// transitions to Busy then fires onDidExecute on subsequent ticks)
			const executionId = await mockKernelManager.waitForExecution();
			assert.ok(executionId, 'Should have captured execution ID');

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
			assert.strictEqual(outputsReceived.length, 1, 'Should receive exactly one output');

			// The output should contain HTML but NOT text/plain
			const output = outputsReceived[0];
			const mimeTypes = output.items.map(item => item.mime);

			assert.ok(mimeTypes.includes('text/html'), 'Output should include text/html');
			assert.ok(!mimeTypes.includes('text/plain'), 'Output should NOT include text/plain when HTML is present');

			// Verify the HTML content is correct
			const htmlItem = output.items.find(item => item.mime === 'text/html');
			assert.ok(htmlItem, 'Should have HTML item');
			assert.ok(htmlItem!.data.includes('<table>'), 'HTML should contain table');
		});

		test('filters out text/plain when image is present', async () => {
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
			disposables.add(outputListener);

			// Start execution
			const executionPromise = executionManager.executeCell(documentUri, cell);

			// Wait for the session's execute to fire
			const executionId = await mockKernelManager.waitForExecution();
			assert.ok(executionId, 'Should have captured execution ID');

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
			assert.strictEqual(outputsReceived.length, 1, 'Should receive exactly one output');

			// The output should contain image/png but NOT text/plain
			const output = outputsReceived[0];
			const mimeTypes = output.items.map(item => item.mime);

			assert.ok(mimeTypes.includes('image/png'), 'Output should include image/png');
			assert.ok(!mimeTypes.includes('text/plain'), 'Output should NOT include text/plain when image is present');
		});

		test('keeps text/plain when no rich format is present', async () => {
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
			disposables.add(outputListener);

			// Start execution
			const executionPromise = executionManager.executeCell(documentUri, cell);

			// Wait for the session's execute to fire
			const executionId = await mockKernelManager.waitForExecution();
			assert.ok(executionId, 'Should have captured execution ID');

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
			assert.strictEqual(outputsReceived.length, 1, 'Should receive exactly one output');

			const output = outputsReceived[0];
			const mimeTypes = output.items.map(item => item.mime);

			assert.ok(mimeTypes.includes('text/plain'), 'Output should include text/plain when no rich format is available');
			assert.strictEqual(output.items[0].data, '5', 'Should have correct text content');
		});

		test('handles both stream output and execute_result output', async () => {
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
			disposables.add(outputListener);

			// Start execution (but don't await yet)
			const executionPromise = executionManager.executeCell(documentUri, cell);

			// Wait for the session's execute to fire
			const executionId = await mockKernelManager.waitForExecution();
			assert.ok(executionId, 'Should have captured execution ID');

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
			assert.ok(outputsReceived.length >= 1, 'Should receive at least one output (stream)');
			assert.strictEqual(outputsReceived[0].items[0].mime, 'application/vnd.code.notebook.stdout');
			assert.strictEqual(outputsReceived[0].items[0].data, 'hello\n');

			// The second output should be the execute_result output
			assert.strictEqual(outputsReceived.length, 2, 'Should receive two outputs (stream + execute_result)');
			assert.strictEqual(outputsReceived[1].items[0].mime, 'text/plain');
			assert.strictEqual(outputsReceived[1].items[0].data, '5');
		});
	});

	suite('Cell Line Number Tracking', () => {
		test('uses current cell line numbers when document is edited before execution', async () => {
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
				mockKernelManager as unknown as IQuartoKernelManager,
				mockDocumentModelService as unknown as IQuartoDocumentModelService,
				trackingEditorService as unknown as IEditorService,
				new MockEphemeralStateService() as unknown as IEphemeralStateService,
				new MockWorkspaceContextService() as unknown as IWorkspaceContextService,
				logService,
				new TestPositronConsoleService() as unknown as IPositronConsoleService,
				new MockRuntimeSessionService() as unknown as IRuntimeSessionService,
				new MockTerminalService() as unknown as ITerminalService,
			);
			disposables.add(executionManagerWithMock);

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
			assert.ok(capturedRange, 'Should have called getValueInRange with a range');
			assert.strictEqual(
				capturedRange!.startLineNumber,
				9,
				'Should use CURRENT cell line numbers (9), not stale ones (6)'
			);
			assert.strictEqual(
				capturedRange!.endLineNumber,
				9,
				'Should use CURRENT cell end line (9), not stale one (6)'
			);
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

class MockEphemeralStateService {
	private _store = new Map<string, unknown>();

	async getItem<T>(key: string): Promise<T | undefined> {
		return this._store.get(key) as T | undefined;
	}

	async setItem(key: string, value: unknown): Promise<void> {
		this._store.set(key, value);
	}

	async removeItem(key: string): Promise<void> {
		this._store.delete(key);
	}
}

class MockWorkspaceContextService {
	getWorkspace(): unknown {
		return { id: 'test-workspace' };
	}
}

class MockRuntimeSessionService {
	getSession(_sessionId: string): ILanguageRuntimeSession | undefined {
		return undefined;
	}

	getConsoleSessionForLanguage(_languageId: string): ILanguageRuntimeSession | undefined {
		return undefined;
	}
}

class MockTerminalService {
	async getActiveOrCreateInstance() {
		return undefined;
	}
}
