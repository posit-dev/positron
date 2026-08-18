/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { INotebookService } from '../../../../contrib/notebook/common/notebookService.js';
import { IPositronHelpService } from '../../../../contrib/positronHelp/browser/positronHelpService.js';
import { IQuartoExecutionManager } from '../../../../contrib/positronQuarto/common/quartoExecutionTypes.js';
import { IRuntimeNotebookKernelService } from '../../../../contrib/runtimeNotebookKernel/common/interfaces/runtimeNotebookKernelService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeCodeExecutionMode, RuntimeErrorBehavior } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { IPositronConnectionsService } from '../../../../services/positronConnections/common/interfaces/positronConnectionsService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { CodeAttributionSource, ILanguageRuntimeCodeExecutedEvent } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { IPositronDataExplorerService } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IExecutionHistoryService } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { IPositronIPyWidgetsService } from '../../../../services/positronIPyWidgets/common/positronIPyWidgetsService.js';
import { IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IPositronWebviewPreloadService } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { IRuntimeSessionMetadata, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { ExtHostLanguageRuntimeShape, RuntimeSessionCapabilities } from '../../../common/positron/extHost.positron.protocol.js';
import { buildRuntimeOpenEventResource, ExtHostLanguageRuntimeSessionAdapter, MainThreadLanguageRuntime } from '../../../browser/positron/mainThreadLanguageRuntime.js';

/**
 * `pathService.fileURI()` is stubbed so these tests run on any host OS;
 * each scenario passes the URI it would have produced on the target OS.
 */

async function callHelper(opts: {
	inputPath: string;
	fileURIResult: URI;
	defaultUriScheme: string;
	remoteAuthority: string | undefined;
}): Promise<URI> {
	const pathService = stubInterface<IPathService>({
		fileURI: vi.fn().mockResolvedValue(opts.fileURIResult),
		defaultUriScheme: opts.defaultUriScheme,
	});
	const environmentService = stubInterface<IWorkbenchEnvironmentService>({
		remoteAuthority: opts.remoteAuthority,
	});
	return buildRuntimeOpenEventResource(opts.inputPath, pathService, environmentService);
}

describe('buildRuntimeOpenEventResource', () => {
	it('#13431 - Windows UNC path, desktop', async () => {
		const uri = await callHelper({
			inputPath: '\\\\NASEN1010\\share\\folder\\file.R',
			fileURIResult: URI.from({ scheme: 'file', authority: 'NASEN1010', path: '/share/folder/file.R' }),
			defaultUriScheme: 'file',
			remoteAuthority: undefined,
		});
		expect(uri.toString()).toBe('file://nasen1010/share/folder/file.R');
	});

	it('#8374 - Windows drive letter, desktop', async () => {
		const uri = await callHelper({
			inputPath: 'C:\\Users\\jenny\\foo.R',
			fileURIResult: URI.from({ scheme: 'file', authority: '', path: '/C:/Users/jenny/foo.R' }),
			defaultUriScheme: 'file',
			remoteAuthority: undefined,
		});
		expect(uri.toString()).toBe('file:///c%3A/Users/jenny/foo.R');
	});

	it('POSIX path, desktop', async () => {
		const uri = await callHelper({
			inputPath: '/Users/jenny/foo.R',
			fileURIResult: URI.from({ scheme: 'file', authority: '', path: '/Users/jenny/foo.R' }),
			defaultUriScheme: 'file',
			remoteAuthority: undefined,
		});
		expect(uri.toString()).toBe('file:///Users/jenny/foo.R');
	});

	it('#10378 - POSIX path, web build: vscode-remote scheme + remote authority populated', async () => {
		const uri = await callHelper({
			inputPath: '/home/jenny/foo.R',
			fileURIResult: URI.from({ scheme: 'file', authority: '', path: '/home/jenny/foo.R' }),
			defaultUriScheme: 'vscode-remote',
			remoteAuthority: 'localhost:8080',
		});
		expect(uri.toString()).toBe('vscode-remote://localhost:8080/home/jenny/foo.R');
	});
});

describe('ExtHostLanguageRuntimeSessionAdapter - missing-package capabilities', () => {
	const disposables = ensureNoLeakedDisposables();

	function createAdapter(capabilities: RuntimeSessionCapabilities) {
		const $getMissingPackageProbe = vi.fn().mockResolvedValue('import requests');
		const proxy = stubInterface<ExtHostLanguageRuntimeShape>({
			$getMissingPackageProbe,
			// Read by the adapter's dispose() via ensureNoLeakedDisposables.
			$disposeLanguageRuntime: vi.fn(),
		});
		const adapter = disposables.add(new ExtHostLanguageRuntimeSessionAdapter(
			{
				handle: 0,
				dynState: { inputPrompt: '>', continuationPrompt: '+', sessionName: 'test' },
				capabilities,
			},
			stubInterface<ILanguageRuntimeMetadata>({}),
			stubInterface<IRuntimeSessionMetadata>({ notebookUri: undefined }),
			stubInterface<IRuntimeSessionService>({
				onDidChangeForegroundSession: Event.None,
				onDidReceiveRuntimeEvent: Event.None,
			}),
			stubInterface<INotificationService>({}),
			new NullLogService(),
			stubInterface<ICommandService>({}),
			stubInterface<INotebookService>({}),
			stubInterface<IEditorService>({}),
			stubInterface<IPathService>({}),
			stubInterface<IWorkbenchEnvironmentService>({}),
			proxy,
			stubInterface<IOpenerService>({}),
		));
		return { adapter, $getMissingPackageProbe };
	}

	it('leaves the optional methods undefined when the extension session lacks them', () => {
		const { adapter } = createAdapter({ listMissingPackages: false, getMissingPackageProbe: false });

		expect(adapter.listMissingPackages).toBeUndefined();
		expect(adapter.getMissingPackageProbe).toBeUndefined();
	});

	it('defines the optional methods when the extension session implements them', () => {
		const { adapter } = createAdapter({ listMissingPackages: true, getMissingPackageProbe: true });

		expect(adapter.listMissingPackages).toBeDefined();
		expect(adapter.getMissingPackageProbe).toBeDefined();
	});

	it('projects the console error to name/message/traceback before crossing the RPC boundary', async () => {
		const { adapter, $getMissingPackageProbe } = createAdapter({ listMissingPackages: true, getMissingPackageProbe: true });

		// A frontend IConsoleError carries extra fields (sessionId, languageId)
		// that must not reach extensions; keep it as a variable so the extra
		// fields pass the structural check.
		const error = {
			name: 'ModuleNotFoundError',
			message: `No module named 'requests'`,
			traceback: [],
			sessionId: 's1',
			languageId: 'python',
		};

		await adapter.getMissingPackageProbe!(error, CancellationToken.None);

		expect($getMissingPackageProbe).toHaveBeenCalledWith(
			0,
			{ name: 'ModuleNotFoundError', message: `No module named 'requests'`, traceback: [] },
			CancellationToken.None,
		);
	});
});

describe('MainThreadLanguageRuntime - code execution event forwarding', () => {
	const disposables = ensureNoLeakedDisposables();

	function codeExecutedEvent(overrides: Partial<ILanguageRuntimeCodeExecutedEvent>): ILanguageRuntimeCodeExecutedEvent {
		return {
			executionId: 'exec-1',
			sessionId: 'session-1',
			languageId: 'python',
			code: 'print("hi")',
			attribution: { source: CodeAttributionSource.Notebook },
			runtimeName: 'Python 3.12',
			mode: RuntimeCodeExecutionMode.Interactive,
			errorBehavior: RuntimeErrorBehavior.Stop,
			...overrides,
		};
	}

	function createMainThread() {
		const consoleEmitter = disposables.add(new Emitter<ILanguageRuntimeCodeExecutedEvent>());
		const notebookEmitter = disposables.add(new Emitter<ILanguageRuntimeCodeExecutedEvent>());
		const quartoEmitter = disposables.add(new Emitter<ILanguageRuntimeCodeExecutedEvent>());

		const $notifyCodeExecuted = vi.fn();
		const proxy = stubInterface<ExtHostLanguageRuntimeShape>({ $notifyCodeExecuted });
		const extHostContext = stubInterface<IExtHostContext>({
			getProxy: (() => proxy) as unknown as IExtHostContext['getProxy'],
		});

		const mainThread = new MainThreadLanguageRuntime(
			extHostContext,
			stubInterface<ILanguageRuntimeService>({ onDidRegisterRuntime: Event.None }),
			stubInterface<IRuntimeSessionService>({ registerSessionManager: () => Disposable.None }),
			stubInterface<IRuntimeStartupService>({ registerRuntimeManager: () => Disposable.None }),
			stubInterface<IRuntimeNotebookKernelService>({ initialize: vi.fn(), onDidExecuteCode: notebookEmitter.event }),
			stubInterface<IPositronConsoleService>({ initialize: vi.fn(), onDidExecuteCode: consoleEmitter.event }),
			stubInterface<IPositronDataExplorerService>({ initialize: vi.fn() }),
			stubInterface<IPositronVariablesService>({ initialize: vi.fn() }),
			stubInterface<IPositronHelpService>({ initialize: vi.fn() }),
			stubInterface<IPositronPlotsService>({ initialize: vi.fn() }),
			stubInterface<IPositronIPyWidgetsService>({ initialize: vi.fn() }),
			stubInterface<IPositronWebviewPreloadService>({ initialize: vi.fn() }),
			stubInterface<IPositronConnectionsService>({ initialize: vi.fn() }),
			stubInterface<INotificationService>({}),
			stubInterface<IQuartoExecutionManager>({ onDidExecuteCode: quartoEmitter.event }),
			stubInterface<IPathService>({}),
			new NullLogService(),
			stubInterface<ICommandService>({}),
			stubInterface<INotebookService>({}),
			stubInterface<IEditorService>({}),
			stubInterface<IOpenerService>({}),
			stubInterface<IWorkbenchEnvironmentService>({}),
			stubInterface<IExecutionHistoryService>({}),
			stubInterface<IConfigurationService>({}),
		);
		disposables.add(mainThread);
		return { consoleEmitter, notebookEmitter, quartoEmitter, $notifyCodeExecuted };
	}

	it('forwards code execution events from the console, notebook, and Quarto sources to the extension host', () => {
		const { consoleEmitter, notebookEmitter, quartoEmitter, $notifyCodeExecuted } = createMainThread();

		const consoleEvent = codeExecutedEvent({ executionId: 'console' });
		const notebookEvent = codeExecutedEvent({ executionId: 'notebook' });
		const quartoEvent = codeExecutedEvent({ executionId: 'quarto' });

		consoleEmitter.fire(consoleEvent);
		notebookEmitter.fire(notebookEvent);
		quartoEmitter.fire(quartoEvent);

		expect($notifyCodeExecuted.mock.calls.map(([event]) => event)).toEqual([
			consoleEvent,
			notebookEvent,
			quartoEvent,
		]);
	});
});
