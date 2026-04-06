/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { TestPositronConsoleService } from '../../../../services/positronConsole/test/browser/testPositronConsoleService.js';
import { ExecutionOutputEvent, ICellOutput } from '../../common/quartoExecutionTypes.js';
import { RuntimeOnlineState, RuntimeOutputKind, LanguageRuntimeSessionLocation, LanguageRuntimeStartupBehavior, LanguageRuntimeSessionMode, ILanguageRuntimeMetadata, RuntimeErrorBehavior, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
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
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';

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

			const executionId = await mockKernelManager.waitForExecution();
			expect(executionId).toBeTruthy();

			// Simulate a pandas DataFrame output that includes both HTML and plain text
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
			expect(outputsReceived.length).toBe(1);

			const output = outputsReceived[0];
			const mimeTypes = output.items.map(item => item.mime);

			expect(mimeTypes.includes('text/html')).toBeTruthy();
			expect(!mimeTypes.includes('text/plain')).toBeTruthy();

			const htmlItem = output.items.find(item => item.mime === 'text/html');
			expect(htmlItem).toBeTruthy();
			expect(htmlItem!.data.includes('<table>')).toBeTruthy();
		});

		it('filters out text/plain when image is present', async () => {
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

			const executionPromise = executionManager.executeCell(documentUri, cell);

			const executionId = await mockKernelManager.waitForExecution();
			expect(executionId).toBeTruthy();

			mockSession.receiveOutputMessage({
				parent_id: executionId,
				kind: RuntimeOutputKind.PlotWidget,
				data: {
					'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
					'text/plain': '<Figure size 640x480 with 1 Axes>'
				},
			});

			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});

			await executionPromise;

			expect(outputsReceived.length).toBe(1);

			const output = outputsReceived[0];
			const mimeTypes = output.items.map(item => item.mime);

			expect(mimeTypes.includes('image/png')).toBeTruthy();
			expect(!mimeTypes.includes('text/plain')).toBeTruthy();
		});

		it('keeps text/plain when no rich format is present', async () => {
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

			const executionPromise = executionManager.executeCell(documentUri, cell);

			const executionId = await mockKernelManager.waitForExecution();
			expect(executionId).toBeTruthy();

			mockSession.receiveResultMessage({
				parent_id: executionId,
				kind: RuntimeOutputKind.Text,
				data: {
					'text/plain': '5'
				},
			});

			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});

			await executionPromise;

			expect(outputsReceived.length).toBe(1);

			const output = outputsReceived[0];
			const mimeTypes = output.items.map(item => item.mime);

			expect(mimeTypes.includes('text/plain')).toBeTruthy();
			expect(output.items[0].data).toBe('5');
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

			const executionPromise = executionManager.executeCell(documentUri, cell);

			const executionId = await mockKernelManager.waitForExecution();
			expect(executionId).toBeTruthy();

			mockSession.receiveStreamMessage({
				parent_id: executionId,
				name: 'stdout',
				text: 'hello\n',
			});

			mockSession.receiveResultMessage({
				parent_id: executionId,
				kind: RuntimeOutputKind.Text,
				data: { 'text/plain': '5' },
			});

			mockSession.receiveStateMessage({
				parent_id: executionId,
				state: RuntimeOnlineState.Idle,
			});

			await executionPromise;

			expect(outputsReceived.length >= 1).toBeTruthy();
			expect(outputsReceived[0].items[0].mime).toBe('application/vnd.code.notebook.stdout');
			expect(outputsReceived[0].items[0].data).toBe('hello\n');

			expect(outputsReceived.length).toBe(2);
			expect(outputsReceived[1].items[0].mime).toBe('text/plain');
			expect(outputsReceived[1].items[0].data).toBe('5');
		});
	});

	describe('Cell Line Number Tracking', () => {
		it('uses current cell line numbers when document is edited before execution', async () => {
			const documentUri = URI.file('/test-line-tracking.qmd');

			const currentCell: QuartoCodeCell = {
				id: '0-abc12345-unlabeled',
				index: 0,
				language: 'python',
				startLine: 8,
				endLine: 10,
				codeStartLine: 9,
				codeEndLine: 9,
				label: undefined,
				options: '',
				contentHash: 'abc12345',
			};

			const editedDocumentLines = [
				'---', 'title: test', '---', '',
				'Some added text',
				'More added text',
				'Even more text',
				'```{python}',
				'x = 1',
				'```',
			];
			const mockModel = new MockQuartoDocumentModel([currentCell], editedDocumentLines);
			const mockDocumentModelService = new MockDocumentModelService();
			mockDocumentModelService.setMockModel(mockModel);

			let capturedRange: { startLineNumber: number; endLineNumber: number } | undefined;
			const trackingEditorService = new MockEditorService();
			trackingEditorService.getValueInRangeCallback = (range: unknown) => {
				const r = range as { startLineNumber: number; endLineNumber: number };
				capturedRange = { startLineNumber: r.startLineNumber, endLineNumber: r.endLineNumber };
				return 'x = 1';
			};

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
			ctx.disposables.add(executionManagerWithMock);

			const staleCellObject: QuartoCodeCell = {
				id: '0-abc12345-unlabeled',
				index: 0,
				language: 'python',
				startLine: 5,
				endLine: 7,
				codeStartLine: 6,
				codeEndLine: 6,
				label: undefined,
				options: '',
				contentHash: 'abc12345',
			};

			const executionPromise = executionManagerWithMock.executeCell(documentUri, staleCellObject);

			const executionId = await mockKernelManager.waitForExecution();

			if (executionId) {
				mockSession.receiveStateMessage({
					parent_id: executionId,
					state: RuntimeOnlineState.Idle,
				});
			}

			await executionPromise;

			expect(capturedRange).toBeTruthy();
			expect(capturedRange!.startLineNumber).toBe(9);
			expect(capturedRange!.endLineNumber).toBe(9);
		});
	});
});

// Mock implementations

/**
 * Mock kernel manager that returns the TestLanguageRuntimeSession directly.
 */
class MockKernelManager extends Disposable {
	lastExecutionId?: string;
	private _executionResolve?: (id: string) => void;

	constructor(private readonly _session: TestLanguageRuntimeSession) {
		super();
		this._register(_session.onDidExecute(id => {
			this.lastExecutionId = id;
			this._executionResolve?.(id);
		}));
	}

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
		return this._session;
	}

	interruptKernelForDocument(_documentUri: URI): void {
		// No-op
	}
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

	onDidStartRuntime(): { dispose(): void } {
		return { dispose() { } };
	}
}

class MockTerminalService {
	async getActiveOrCreateInstance() {
		return undefined;
	}
}
