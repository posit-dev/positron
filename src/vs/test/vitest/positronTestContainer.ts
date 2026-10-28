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

import { ServiceIdentifier } from '../../platform/instantiation/common/instantiation.js';
import { PositronReactServices } from '../../base/browser/positronReactServices.js';
import { ContainerSetup, LightTestContainerBuilder, LightTestContainerResult } from './lightTestContainer.js';
import { createNotebookContainer } from './presets/notebook.js';
import { createWorkbenchContainer } from './presets/workbench.js';
import { stubReactServices } from './presets/reactServices.js';
import { stubContributionServices } from './presets/contributionServices.js';
import { stubNotebookEditorServices } from './presets/notebookEditor.js';

interface TestContainerResult extends LightTestContainerResult {
	/**
	 * Services object for PositronReactServicesContext. Only available with
	 * `withReactServices()`. Pass to `setupRTLRenderer(() => ctx.reactServices)`.
	 * Created fresh from the DI container each time it's accessed (after beforeEach).
	 */
	reactServices: PositronReactServices;
}

/**
 * Fluent builder for test containers. Provides presets for common service
 * groupings. Pick the lowest preset that covers your test's dependencies,
 * then use .stub() for anything extra.
 *
 * Importing this module loads the Notebook and Workbench presets (~7s per
 * test file). If your test needs only Bare or Runtime, use
 * `createLightTestContainer()` from lightTestContainer.ts instead; the
 * local/code-vitest-light-test-container lint rule enforces this.
 *
 * ## Presets
 *
 * Base presets (exactly one runs; the most specific one wins):
 *   Bare       -- no services, for pure logic tests
 *   Runtime    -- language runtime + session services (~18)
 *   Notebook   -- base workbench + runtime + notebook/kernel services (+8)
 *   Workbench  -- full Positron stack (124+; includes runtime + notebook)
 *
 * Stackable layers (applied on top of the base; all can be used together):
 *   ReactServices         -- enables ctx.reactServices for RTL tests
 *   ContributionServices  -- Event.None stubs for editor/notebook lifecycle events
 *   NotebookEditorServices -- editor/language/tree-sitter/webview-preload stubs
 *                            needed to attach TestCodeEditor to notebook cells
 *
 * All layers imply the Workbench base. You can chain them:
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
 *     method, and a branch in resolveSetup(). A cheap base (one that doesn't
 *     reach the workbench) belongs in lightTestContainer.ts instead.
 *   - For a new layer: add a file under presets/ exporting a stub*() helper,
 *     a boolean flag, a with*() method, and an `if (useX) stubX(svc)` line
 *     in resolveSetup()'s layer block.
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
 * const ctx = createTestContainer().withReactServices().build();
 * const rtl = setupRTLRenderer(() => ctx.reactServices);
 * ```
 */
export class PositronTestContainerBuilder extends LightTestContainerBuilder {
	private _useNotebookServices = false;
	private _useWorkbenchServices = false;
	private _useContributionServices = false;
	private _useReactServices = false;
	private _useNotebookEditorServices = false;

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
	 * Layer: add the editor/language/tree-sitter/webview-preload services
	 * required to attach TestCodeEditor instances to notebook cells. Use
	 * this for tests that instantiate a PositronNotebookInstance via
	 * `instantiateTestNotebookInstance()`.
	 *
	 * Implies the Workbench base. Stackable with the other layers.
	 */
	withNotebookEditorServices(): this {
		this._useNotebookEditorServices = true;
		return this;
	}

	protected override resolveSetup(): ContainerSetup {
		const useNotebookServices = this._useNotebookServices;
		const useReactServices = this._useReactServices;
		const useContributionServices = this._useContributionServices;
		const useNotebookEditorServices = this._useNotebookEditorServices;

		// 1. Pick the base. Exactly one runs; most-specific wins. React,
		//    Contribution, and NotebookEditor layers all imply the Workbench base.
		const needsWorkbench = this._useWorkbenchServices || useReactServices || useContributionServices || useNotebookEditorServices;
		if (!needsWorkbench) {
			return useNotebookServices ? createNotebookContainer : super.resolveSetup();
		}

		return disposables => {
			const svc = createWorkbenchContainer(disposables);

			// 2. Apply layers additively. Any can run; order doesn't matter
			//    because they stub disjoint services today. If they ever
			//    overlap, the later-applied layer wins -- document it then.
			if (useReactServices) {
				stubReactServices(svc);
			}
			if (useContributionServices) {
				stubContributionServices(svc);
			}
			if (useNotebookEditorServices) {
				stubNotebookEditorServices(svc, disposables);
			}
			return svc;
		};
	}

	/** Build the container. Adds `reactServices` to the light builder's result. */
	override build(): TestContainerResult {
		const result = super.build();
		return {
			get instantiationService() { return result.instantiationService; },
			get reactServices() { return result.instantiationService.createInstance(PositronReactServices); },
			get<T>(id: ServiceIdentifier<T>) { return result.get(id); },
			disposables: result.disposables,
		};
	}
}

/** Create a test container with fluent builder API. */
export function createTestContainer(): PositronTestContainerBuilder {
	return new PositronTestContainerBuilder();
}
