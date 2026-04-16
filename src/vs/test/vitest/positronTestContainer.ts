/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// MAINTENANCE: This directory (src/vs/test/vitest/) is excluded from tsc
// compilation via two mechanisms:
//   - src/tsconfig.json "exclude" array (glob: ./vs/test/vitest/**)
//   - build/lib/compilation.ts isVitestFile() (path check: /test/vitest/)
// If you move or rename this directory, update both exclusion sites. Both
// checks match the whole subtree, so new files under presets/ are covered.

// This file uses Vitest hooks (beforeEach, ensureNoLeakedDisposables).
// It is ONLY imported by .vitest.ts files. No Mocha .test.ts or .test.tsx
// file imports this module. Verified via: grep -rl 'positronTestContainer' --include='*.test.ts' src/vs

import { DisposableStore } from '../../base/common/lifecycle.js';
import { ServiceIdentifier } from '../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../platform/instantiation/test/common/instantiationServiceMock.js';
import { PositronReactServices } from '../../base/browser/positronReactServices.js';
import { ensureNoLeakedDisposables } from './vitestUtils.js';
import { createBareContainer } from './presets/bare.js';
import { createRuntimeContainer } from './presets/runtime.js';
import { createNotebookContainer } from './presets/notebook.js';
import { createWorkbenchContainer } from './presets/workbench.js';
import { stubReactServices } from './presets/reactServices.js';
import { stubContributionServices } from './presets/contributionServices.js';

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
 * Fluent builder for test containers. Provides presets for common service
 * groupings. Pick the lowest preset that covers your test's dependencies,
 * then use .stub() for anything extra.
 *
 * ## Presets
 *
 * Base presets (exactly one runs; the most specific one wins):
 *   Bare       -- no services, for pure logic tests
 *   Runtime    -- language runtime + session services (~18)
 *   Notebook   -- base workbench + runtime + notebook/kernel services (+8)
 *   Workbench  -- full Positron stack (124+; includes runtime + notebook)
 *
 * Stackable layers (applied on top of the base; both can be used together):
 *   ReactServices        -- enables ctx.reactServices for RTL tests
 *   ContributionServices -- Event.None stubs for editor/notebook lifecycle events
 *
 * Both layers imply the Workbench base. You can chain them:
 *   `createTestContainer().withReactServices().withContributionServices()`
 * applies both. Layer order does not matter; user `.stub()` calls always win.
 *
 * When to add a new preset:
 *   - 2+ test files across different directories need the same .stub() set
 *   - The stubs are non-trivial (emitters, real instances), not just `{}`
 *   - The services map to a recognizable domain (e.g. "Quarto", "Plots")
 *   If only one file needs the combination, use an existing preset + .stub().
 *
 * How to add a new preset:
 *   - For a new base: add a file under presets/, a boolean flag, a with*()
 *     method, and a branch in build()'s base-selection block.
 *   - For a new layer: add a file under presets/ exporting a stub*() helper,
 *     a boolean flag, a with*() method, and an `if (useX) stubX(svc)` line
 *     in build()'s layer block.
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
 *    `.stub(IMissingService, {})`
 * 3. If the code calls a specific method, add just that method:
 *    `.stub(IMissingService, { getDoc: () => undefined })`
 * 4. If the code subscribes to an event, add an Emitter:
 *    ```
 *    const onDidChange = new Emitter<void>();
 *    .stub(IService, { onDidChange: onDidChange.event })
 *    ```
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
 *   `executeCommand`). Use `vi.fn()`/`vi.spyOn()` for stubs and spies.
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
	 * Layer: add stubs needed for PositronReactServicesContext. Enables
	 * `ctx.reactServices` for use with `setupRTLRenderer(() => ctx.reactServices)`.
	 * Use this for testing React components that call `usePositronReactServicesContext()`.
	 *
	 * Implies the Workbench base. Stackable with `.withContributionServices()`.
	 */
	withReactServices(): this {
		this._useReactServices = true;
		return this;
	}

	/**
	 * Layer: add Event.None stubs for editor/notebook lifecycle events. Use
	 * this when testing workbench contributions that subscribe to editor,
	 * notebook, and code editor events in their constructors. Provides safe
	 * no-op defaults for:
	 *   - INotebookEditorService (onDidAddNotebookEditor, onDidRemoveNotebookEditor)
	 *   - ICodeEditorService (onCodeEditorAdd, onCodeEditorRemove)
	 *   - IPositronNotebookService (onDidAddNotebookInstance, onDidRemoveNotebookInstance)
	 *   - IQuartoKernelManager (getSessionForDocument)
	 * Override any of these with .stub() for tests that need to control specific events.
	 *
	 * Implies the Workbench base. Stackable with `.withReactServices()`.
	 */
	withContributionServices(): this {
		this._useContributionServices = true;
		return this;
	}

	/**
	 * Stub a specific service. Applied after presets, so it overrides preset defaults.
	 *
	 * Pass a partial object with only the methods/properties your test needs.
	 * No `as Partial<T>` cast required -- the builder handles the type boundary.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	stub(id: ServiceIdentifier<any>, impl: object): this {
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
			// 1. Pick the base. Exactly one runs; most-specific wins. React
			//    and Contribution layers both imply the Workbench base.
			const needsWorkbench = useWorkbenchServices || useReactServices || useContributionServices;
			if (needsWorkbench) {
				_instantiationService = createWorkbenchContainer(disposables);
			} else if (useNotebookServices) {
				_instantiationService = createNotebookContainer(disposables);
			} else if (useRuntimeServices) {
				_instantiationService = createRuntimeContainer(disposables);
			} else {
				_instantiationService = createBareContainer(disposables);
			}

			// 2. Apply layers additively. Both can run; order doesn't matter
			//    because they stub disjoint services today. If they ever
			//    overlap, the later-applied layer wins -- document it then.
			if (useReactServices) {
				stubReactServices(_instantiationService);
			}
			if (useContributionServices) {
				stubContributionServices(_instantiationService);
			}

			// 3. User stubs last -- they always win over preset defaults.
			for (const { id, impl } of stubs) {
				_instantiationService.stub(id, impl);
			}
		});

		// Return a result object with lazy getters that delegate to the mutable slot.
		// Access these inside it()/beforeEach() callbacks, not at describe level.
		// Destructuring at describe level (const { instantiationService } = ctx)
		// evaluates the getter immediately, before beforeEach has run.
		function assertReady(): TestInstantiationService {
			if (!_instantiationService) {
				throw new Error(
					'ctx properties are not available until beforeEach runs. ' +
					'Do not destructure ctx at describe level -- use ctx.instantiationService inside it() callbacks.'
				);
			}
			return _instantiationService;
		}
		const result: TestContainerResult = {
			get instantiationService() { return assertReady(); },
			get reactServices() { return assertReady().createInstance(PositronReactServices); },
			get<T>(id: ServiceIdentifier<T>) { return assertReady().get(id); },
			disposables,
		};
		return result;
	}
}

/** Create a test container with fluent builder API. */
export function createTestContainer(): PositronTestContainerBuilder {
	return new PositronTestContainerBuilder();
}
