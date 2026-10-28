/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// This file uses Vitest hooks (beforeEach, ensureNoLeakedDisposables).
// It is ONLY imported by .vitest.ts files and positronTestContainer.ts.

import { DisposableStore } from '../../base/common/lifecycle.js';
import { ServiceIdentifier } from '../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ensureNoLeakedDisposables } from './vitestUtils.js';
import { createBareContainer } from './presets/bare.js';
import { createRuntimeContainer } from './presets/runtime.js';

export interface LightTestContainerResult {
	/** Retrieve a registered service by its identifier. */
	get: <T>(id: ServiceIdentifier<T>) => T;
	/** The underlying instantiation service (escape hatch for advanced use). */
	instantiationService: TestInstantiationService;
	/** Disposable store -- auto-cleaned after each test. Pass to helpers that need it. */
	disposables: Pick<DisposableStore, 'add'>;
}

/** Creates a fresh, preset-wired container for one test. */
export type ContainerSetup = (disposables: Pick<DisposableStore, 'add'>) => TestInstantiationService;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- service stubs are inherently untyped
type ServiceStub = { id: ServiceIdentifier<any>; impl: any };

/**
 * The test container builder with only the Bare and Runtime presets.
 *
 * Use this instead of `createTestContainer()` from positronTestContainer.ts
 * when a test needs no more than runtime services. That module imports the
 * Notebook and Workbench presets, which load most of the workbench and cost
 * ~7s of import per test file even when the test never uses them.
 * The local/code-vitest-light-test-container lint rule flags a test that
 * imports the full builder without using one of its heavy presets.
 *
 * See positronTestContainer.ts for the full preset list, incremental-mocking
 * workflow, and test style.
 *
 * ```typescript
 * const ctx = createLightTestContainer().withRuntimeServices().build();
 * const session = await startTestLanguageRuntimeSession(
 *     ctx.instantiationService, ctx.disposables);
 * ```
 */
export class LightTestContainerBuilder {
	private _useRuntimeServices = false;
	private _stubs: ServiceStub[] = [];

	/** Add the 18 runtime/language services (ILanguageRuntimeService, IRuntimeSessionService, etc.) */
	withRuntimeServices(): this {
		this._useRuntimeServices = true;
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
	 * Pick the preset setup from the builder's flags. Called once, by build();
	 * subclasses override it to add heavier presets.
	 */
	protected resolveSetup(): ContainerSetup {
		return this._useRuntimeServices ? createRuntimeContainer : createBareContainer;
	}

	/**
	 * Build the container. Returns get(), instantiationService, and disposables.
	 *
	 * Must be called at describe-level (not inside beforeEach). The builder registers
	 * its own beforeEach hook to create a fresh instantiation service and apply presets
	 * each test, so the disposable store created by ensureNoLeakedDisposables()
	 * is always initialized before service setup runs.
	 */
	build(): LightTestContainerResult {
		const disposables = ensureNoLeakedDisposables();
		const stubs = [...this._stubs];
		const setup = this.resolveSetup();

		// Mutable slot -- reassigned in beforeEach so each test starts fresh.
		let _instantiationService: TestInstantiationService;

		beforeEach(() => {
			_instantiationService = setup(disposables);

			// User stubs last -- they always win over preset defaults.
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
					'Do not destructure ctx at describe level -- access ctx properties (e.g. ctx.instantiationService, ctx.get) inside it() callbacks.'
				);
			}
			return _instantiationService;
		}
		return {
			get instantiationService() { return assertReady(); },
			get<T>(id: ServiceIdentifier<T>) { return assertReady().get(id); },
			disposables,
		};
	}
}

/** Create a test container with only the Bare and Runtime presets. */
export function createLightTestContainer(): LightTestContainerBuilder {
	return new LightTestContainerBuilder();
}
