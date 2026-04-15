/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This file uses Vitest hooks (beforeEach, ensureNoLeakedDisposables).
// It is ONLY imported by .vitest.ts files. No Mocha .test.ts or .test.tsx
// file imports this module. Verified via: grep -rl 'positronTestContainer' --include='*.test.ts' src/vs

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { Event } from '../../../base/common/event.js';
import { ServiceIdentifier } from '../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../platform/instantiation/common/serviceCollection.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { createRuntimeServices } from '../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { positronWorkbenchInstantiationService } from './positronWorkbenchTestServices.js';
import { ensureNoLeakedDisposables } from '../../../base/test/common/vitestUtils.js';
import { INotebookExecutionService } from '../../contrib/notebook/common/notebookExecutionService.js';
import { INotebookExecutionStateService } from '../../contrib/notebook/common/notebookExecutionStateService.js';
import { INotebookRendererMessagingService } from '../../contrib/notebook/common/notebookRendererMessagingService.js';
import { NotebookRendererMessagingService } from '../../contrib/notebook/browser/services/notebookRendererMessagingServiceImpl.js';
import { INotebookEditorService } from '../../contrib/notebook/browser/services/notebookEditorService.js';
import { NotebookEditorWidgetService } from '../../contrib/notebook/browser/services/notebookEditorServiceImpl.js';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from '../../services/notebook/common/notebookDocumentService.js';
import { INotebookService } from '../../contrib/notebook/common/notebookService.js';
import { NotebookService } from '../../contrib/notebook/browser/services/notebookServiceImpl.js';
import { INotebookKernelService } from '../../contrib/notebook/common/notebookKernelService.js';
import { NotebookKernelService } from '../../contrib/notebook/browser/services/notebookKernelServiceImpl.js';
import { INotebookLoggingService } from '../../contrib/notebook/common/notebookLoggingService.js';
import { NotebookLoggingService } from '../../contrib/notebook/browser/services/notebookLoggingServiceImpl.js';
import { TestNotebookExecutionService } from '../../test/common/positronWorkbenchTestServices.js';
import { TestNotebookExecutionStateService } from '../../contrib/notebook/test/browser/testNotebookEditor.js';
import { workbenchInstantiationService as baseWorkbenchInstantiationService } from './workbenchTestServices.js';
import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
import { IPositronNotebookService } from '../../contrib/positronNotebook/browser/positronNotebookService.js';
import { IQuartoKernelManager } from '../../contrib/positronQuarto/browser/quartoKernelManager.js';
import { PositronReactServices } from '../../../base/browser/positronReactServices.js';
import { IActionWidgetService } from '../../../platform/actionWidget/browser/actionWidget.js';
import { IClipboardService } from '../../../platform/clipboard/common/clipboardService.js';
import { IExecutionHistoryService } from '../../services/positronHistory/common/executionHistoryService.js';
import { ILanguageModelsService } from '../../contrib/chat/common/languageModels.js';
import { IPositronAssistantService } from '../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { IPositronConnectionsService } from '../../services/positronConnections/common/interfaces/positronConnectionsService.js';
import { IPositronDataExplorerService } from '../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronHelpService } from '../../contrib/positronHelp/browser/positronHelpService.js';
import { IPositronMemoryUsageService } from '../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { IPositronPackagesService } from '../../contrib/positronPackages/browser/interfaces/positronPackagesService.js';
import { IPositronPreviewService } from '../../contrib/positronPreview/browser/positronPreviewSevice.js';
import { IPositronTopActionBarService } from '../../services/positronTopActionBar/browser/positronTopActionBarService.js';
import { IQuickChatService } from '../../contrib/chat/browser/chat.js';
import { IResourceUsageHistoryService } from '../../services/positronConsole/browser/resourceUsageHistoryService.js';
import { ITerminalService } from '../../contrib/terminal/browser/terminal.js';
import { IViewDescriptorService } from '../../common/views.js';

interface TestContainerResult {
	/** Retrieve a registered service by its identifier. */
	get: <T>(id: ServiceIdentifier<T>) => T;
	/** The underlying instantiation service (escape hatch for advanced use). */
	instantiationService: TestInstantiationService;
	/** Disposable store -- auto-cleaned after each test. Pass to helpers that need it. */
	disposables: Pick<DisposableStore, 'add'>;
	/**
	 * Services object for PositronReactServicesContext. Only available with
	 * `withReactServices()`. Pass to `setupRTLRenderer(() => ctx.reactServices)`.
	 * Created fresh from the DI container each time it's accessed (after beforeEach).
	 */
	reactServices: PositronReactServices;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- service stubs are inherently untyped
type ServiceStub = { id: ServiceIdentifier<any>; impl: any };

/**
 * Fluent builder for test containers. Provides presets for common
 * service groupings. Pick the lowest preset that covers your test's
 * dependencies, then use .stub() for anything extra.
 *
 * ## Presets
 *
 * Each preset includes the one above it:
 *   Bare           -- no services, for pure logic tests
 *   Runtime        -- language runtime + session services (~18)
 *   Notebooks      -- runtime + notebook/kernel services (+8)
 *   Workbench      -- full Positron stack (124+)
 *   Contributions  -- workbench + Event.None stubs for editor/notebook lifecycle
 *   ReactServices  -- workbench + stubs for PositronReactServicesContext (adds ctx.reactServices)
 *
 * When to add a new preset:
 *   - 2+ test files across different directories need the same .stub() set
 *   - The stubs are non-trivial (emitters, real instances), not just {} as T
 *   - The services map to a recognizable domain (e.g. "Quarto", "Plots")
 *   If only one file needs the combination, use an existing preset + .stub().
 *
 * How to add a new preset: add a boolean flag, a with*() method, and an
 * else-if branch in build(). See withNotebookServices() for an example.
 *
 * ## Test* classes vs .stub()
 *
 * The presets wire up existing Test* classes where they exist (e.g.
 * TestPositronConsoleService, TestConfigurationService). These are
 * convenience defaults -- any can be overridden with .stub(IService, partial).
 * For new tests, prefer .stub() with a partial object over creating new
 * Test* classes. Only create a Test* class when multiple tests need the
 * same complex mock behavior (emitters, state management, etc.).
 *
 * ## Incremental mocking
 *
 * Build mocks incrementally -- start with nothing and let the test tell you
 * what's missing:
 *
 * 1. Start with a preset and run the test. If it passes, you're done.
 * 2. "X is not a function" or "Cannot read properties of undefined" means
 *    a service is missing. Add an empty stub:
 *    `.stub(IMissingService, {} as IMissingService)`
 * 3. If the code calls a specific method, add just that method:
 *    `.stub(IMissingService, { getDoc: () => undefined } as IMissingService)`
 * 4. If the code subscribes to an event, add an Emitter:
 *    ```
 *    const onDidChange = new Emitter<void>();
 *    .stub(IService, { onDidChange: onDidChange.event } as IService)
 *    ```
 *
 * Use `Partial<T>` with only the members your test needs, cast with `as T`.
 * This may trigger `local/code-no-dangerous-type-assertions`; add
 * `// eslint-disable local/code-no-dangerous-type-assertions` below the
 * copyright header.
 *
 * ## Disposables
 *
 * The builder handles disposable leak detection automatically. Access the
 * disposable store via `ctx.disposables` to register disposables created
 * in tests:
 *   `ctx.disposables.add(someDisposable);`
 *
 * ## Lazy getters
 *
 * `ctx` uses lazy getters. Access `ctx.instantiationService` inside
 * `beforeEach`/`it` callbacks, not at suite-level via destructuring.
 *
 * ## Test style
 *
 * - Group related tests with nested `describe()` calls, not comment headers.
 * - Prefer events/state to verify behavior (e.g. await
 *   `TestCommandService.onWillExecuteCommand` instead of stubbing
 *   `executeCommand`). Use sinon only when no observable signal exists.
 * - Await events with `Event.toPromise(event)` instead of timeouts.
 * - For debounce/throttle/scheduler logic, use `runWithFakedTimers`.
 *
 * ## Usage
 *
 * ```typescript
 * const ctx = createTestContainer().withRuntimeServices().build();
 * const session = await startTestLanguageRuntimeSession(
 *     ctx.instantiationService, ctx.disposables);
 * ```
 */
class PositronTestContainerBuilder {
	private _useRuntimeServices = false;
	private _useNotebookServices = false;
	private _useWorkbenchServices = false;
	private _useContributionServices = false;
	private _useReactServices = false;
	private _stubs: ServiceStub[] = [];

	/** Add the 18 runtime/language services (ILanguageRuntimeService, IRuntimeSessionService, etc.) */
	withRuntimeServices(): this {
		this._useRuntimeServices = true;
		return this;
	}

	/** Add runtime services + 8 notebook services (INotebookService, INotebookEditorService, etc.) */
	withNotebookServices(): this {
		this._useNotebookServices = true;
		return this;
	}

	/** Add the full 124+ workbench service stack (includes runtime + notebook services). */
	withWorkbenchServices(): this {
		this._useWorkbenchServices = true;
		return this;
	}

	/**
	 * Add workbench services + stubs needed to create PositronReactServicesContext.
	 * Enables `ctx.reactServices` for use with `setupRTLRenderer(() => ctx.reactServices)`.
	 * Use this for testing React components that call `usePositronReactServicesContext()`.
	 */
	withReactServices(): this {
		this._useReactServices = true;
		return this;
	}

	/**
	 * Add workbench services + Event.None stubs for editor/notebook lifecycle events.
	 * Use this when testing workbench contributions that subscribe to editor, notebook,
	 * and code editor events in their constructors. Provides safe no-op defaults for:
	 *   - INotebookEditorService (onDidAddNotebookEditor, onDidRemoveNotebookEditor)
	 *   - ICodeEditorService (onCodeEditorAdd, onCodeEditorRemove)
	 *   - IPositronNotebookService (onDidAddNotebookInstance, onDidRemoveNotebookInstance)
	 *   - IQuartoKernelManager (getSessionForDocument)
	 * Override any of these with .stub() for tests that need to control specific events.
	 */
	withContributionServices(): this {
		this._useContributionServices = true;
		return this;
	}

	/** Stub a specific service. Applied after presets, so it overrides preset defaults. */
	stub<T>(id: ServiceIdentifier<T>, impl: Partial<T>): this {
		this._stubs.push({ id, impl });
		return this;
	}

	/**
	 * Build the container. Returns get(), instantiationService, and disposables.
	 *
	 * Must be called at describe-level (not inside beforeEach). The builder registers
	 * its own beforeEach hook to create a fresh instantiation service and apply presets
	 * each test, so the disposable store created by ensureNoLeakedDisposables()
	 * is always initialized before service setup runs.
	 */
	build(): TestContainerResult {
		const disposables = ensureNoLeakedDisposables();
		const stubs = [...this._stubs];
		const useRuntimeServices = this._useRuntimeServices;
		const useNotebookServices = this._useNotebookServices;
		const useWorkbenchServices = this._useWorkbenchServices;
		const useContributionServices = this._useContributionServices;
		const useReactServices = this._useReactServices;

		// Mutable slot -- reassigned in beforeEach so each test starts fresh.
		let _instantiationService: TestInstantiationService;

		beforeEach(() => {
			if (useReactServices) {
				_instantiationService = positronWorkbenchInstantiationService(disposables);
				// Stub services that PositronReactServices needs but the workbench
				// preset doesn't provide. Empty stubs are sufficient -- tests override
				// specific services via .stub() as needed.
				const emptyStubs: [ServiceIdentifier<any>, any][] = [
					[IActionWidgetService, {}],
					[IClipboardService, {}],
					[IExecutionHistoryService, {}],
					[ILanguageModelsService, {}],
					[IPositronAssistantService, {}],
					[IPositronConnectionsService, {}],
					[IPositronDataExplorerService, {}],
					[IPositronHelpService, {}],
					[IPositronMemoryUsageService, {}],
					[IPositronPackagesService, {}],
					[IPositronPreviewService, {}],
					[IPositronTopActionBarService, {}],
					[IQuickChatService, {}],
					[IResourceUsageHistoryService, {}],
					[ITerminalService, {}],
					[IViewDescriptorService, {}],
				];
				for (const [id, impl] of emptyStubs) {
					_instantiationService.stub(id, impl);
				}
			} else if (useContributionServices) {
				_instantiationService = positronWorkbenchInstantiationService(disposables);
				// Event.None stubs for services that contributions subscribe to
				// in their constructors. Tests can override any of these with .stub().
				_instantiationService.stub(INotebookEditorService, {
					onDidAddNotebookEditor: Event.None,
					onDidRemoveNotebookEditor: Event.None,
					listNotebookEditors: () => [],
				} as Partial<INotebookEditorService>);
				_instantiationService.stub(ICodeEditorService, {
					onCodeEditorAdd: Event.None,
					onCodeEditorRemove: Event.None,
					listCodeEditors: () => [],
					getActiveCodeEditor: () => null,
				} as Partial<ICodeEditorService>);
				_instantiationService.stub(IPositronNotebookService, {
					onDidAddNotebookInstance: Event.None,
					onDidRemoveNotebookInstance: Event.None,
					listInstances: () => [],
				} as Partial<IPositronNotebookService>);
				_instantiationService.stub(IQuartoKernelManager, {
					getSessionForDocument: () => undefined,
				} as Partial<IQuartoKernelManager>);
			} else if (useWorkbenchServices) {
				_instantiationService = positronWorkbenchInstantiationService(disposables);
			} else if (useNotebookServices) {
				// Runtime services + base workbench (for editor/theme deps) + notebook services.
				_instantiationService = baseWorkbenchInstantiationService(undefined, disposables);
				createRuntimeServices(_instantiationService, disposables);
				_instantiationService.stub(INotebookExecutionService, new TestNotebookExecutionService());
				_instantiationService.stub(INotebookExecutionStateService, _instantiationService.createInstance(TestNotebookExecutionStateService));
				_instantiationService.stub(INotebookRendererMessagingService, disposables.add(_instantiationService.createInstance(NotebookRendererMessagingService)));
				_instantiationService.stub(INotebookEditorService, disposables.add(_instantiationService.createInstance(NotebookEditorWidgetService)));
				_instantiationService.stub(INotebookDocumentService, new NotebookDocumentWorkbenchService());
				_instantiationService.stub(INotebookService, disposables.add(_instantiationService.createInstance(NotebookService)));
				_instantiationService.stub(INotebookKernelService, disposables.add(_instantiationService.createInstance(NotebookKernelService)));
				_instantiationService.stub(INotebookLoggingService, disposables.add(_instantiationService.createInstance(NotebookLoggingService)));
			} else if (useRuntimeServices) {
				_instantiationService = disposables.add(new TestInstantiationService(new ServiceCollection()));
				createRuntimeServices(_instantiationService, disposables);
			} else {
				_instantiationService = disposables.add(new TestInstantiationService(new ServiceCollection()));
			}

			for (const { id, impl } of stubs) {
				_instantiationService.stub(id, impl);
			}
		});

		// Return a result object whose properties delegate to the mutable slot.
		// This is safe because tests only access these after beforeEach has run.
		const result: TestContainerResult = {
			get instantiationService() { return _instantiationService; },
			get reactServices() { return _instantiationService.createInstance(PositronReactServices); },
			get<T>(id: ServiceIdentifier<T>) { return _instantiationService.get(id); },
			disposables,
		};
		return result;
	}
}

/** Create a test container with fluent builder API. */
export function createTestContainer(): PositronTestContainerBuilder {
	return new PositronTestContainerBuilder();
}
