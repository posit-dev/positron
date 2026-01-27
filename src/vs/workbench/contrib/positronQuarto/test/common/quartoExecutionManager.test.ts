/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { ExecutionOutputEvent, ICellOutput } from '../../common/quartoExecutionTypes.js';
import { RuntimeOnlineState, RuntimeOutputKind, LanguageRuntimeSessionLocation, LanguageRuntimeStartupBehavior, LanguageRuntimeSessionMode, ILanguageRuntimeMetadata, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { QuartoExecutionManager } from '../../browser/quartoExecutionManager.js';
import { IQuartoKernelManager } from '../../browser/quartoKernelManager.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { QuartoCodeCell } from '../../common/quartoTypes.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IEphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralState.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';

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
		mockKernelManager = new MockKernelManager(mockSession);
		const mockDocumentModelService = new MockDocumentModelService();
		const mockEditorService = new MockEditorService();
		const mockEphemeralStateService = new MockEphemeralStateService();
		const mockWorkspaceContextService = new MockWorkspaceContextService();

		// Create execution manager
		executionManager = new QuartoExecutionManager(
			mockKernelManager as unknown as IQuartoKernelManager,
			mockDocumentModelService as unknown as IQuartoDocumentModelService,
			mockEditorService as unknown as IEditorService,
			mockEphemeralStateService as unknown as IEphemeralStateService,
			mockWorkspaceContextService as unknown as IWorkspaceContextService,
			logService,
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

			// Wait for execution to start
			await new Promise(resolve => setTimeout(resolve, 50));

			// Get the execution ID
			const executionId = mockKernelManager.lastExecutionId!;
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

			// Wait for execution to start
			await new Promise(resolve => setTimeout(resolve, 50));

			// Get the execution ID
			const executionId = mockKernelManager.lastExecutionId!;
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

			// Wait for execution to start
			await new Promise(resolve => setTimeout(resolve, 50));

			// Get the execution ID
			const executionId = mockKernelManager.lastExecutionId!;
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

			// Wait a tick for execution to start and listen for it
			await new Promise(resolve => setTimeout(resolve, 50));

			// Get the execution ID that was used
			const executionId = mockKernelManager.lastExecutionId!;
			assert.ok(executionId, 'Should have captured execution ID');

			// Simulate stdout stream output (like from print("hello"))
			mockSession.receiveStreamMessage({
				parent_id: executionId,
				name: 'stdout',
				text: 'hello\n',
			});

			// Simulate execute_result output (like from "2 + 3")
			// This is the bug - execute_result messages are not being handled
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
			// THIS IS THE BUG: Currently outputsReceived.length === 1, but should be 2
			assert.strictEqual(outputsReceived.length, 2, 'Should receive two outputs (stream + execute_result)');
			assert.strictEqual(outputsReceived[1].items[0].mime, 'text/plain');
			assert.strictEqual(outputsReceived[1].items[0].data, '5');
		});
	});
});

// Mock implementations

class MockKernelManager {
	lastExecutionId?: string;

	constructor(private readonly _session: TestLanguageRuntimeSession) { }

	async ensureKernelForDocument(_documentUri: URI, _token?: CancellationToken): Promise<ILanguageRuntimeSession | undefined> {
		// Return a wrapped session that captures the execution ID
		const session = this._session;
		const self = this;

		return {
			...session,
			execute(_code: string, id: string, _mode: unknown, _errorBehavior: unknown) {
				self.lastExecutionId = id;
				// Don't call the real execute - we just capture the ID
			},
			onDidReceiveRuntimeMessageOutput: session.onDidReceiveRuntimeMessageOutput,
			onDidReceiveRuntimeMessageResult: session.onDidReceiveRuntimeMessageResult,
			onDidReceiveRuntimeMessageStream: session.onDidReceiveRuntimeMessageStream,
			onDidReceiveRuntimeMessageError: session.onDidReceiveRuntimeMessageError,
			onDidReceiveRuntimeMessageState: session.onDidReceiveRuntimeMessageState,
		} as unknown as ILanguageRuntimeSession;
	}

	interruptKernelForDocument(_documentUri: URI): void {
		// No-op
	}
}

class MockDocumentModelService {
	getModel(_textModel: unknown): unknown {
		return {
			getCellCode(_cell: QuartoCodeCell): string {
				return 'test code';
			}
		};
	}
}

class MockEditorService {
	findEditors(_resource: unknown): unknown[] {
		return [{
			editor: {
				resolve: async () => ({
					textEditorModel: {
						getValue: () => 'test code',
						getLineContent: (_line: number) => 'test code',
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
