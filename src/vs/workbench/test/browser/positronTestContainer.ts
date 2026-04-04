/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ServiceIdentifier } from '../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../platform/instantiation/common/serviceCollection.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { createRuntimeServices } from '../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { positronWorkbenchInstantiationService } from './positronWorkbenchTestServices.js';
import { ensureNoLeakedDisposables } from '../../../base/test/common/vitestSetup.js';

interface TestContainerResult {
	/** Retrieve a registered service by its identifier. */
	get: <T>(id: ServiceIdentifier<T>) => T;
	/** The underlying instantiation service (escape hatch for advanced use). */
	instantiationService: TestInstantiationService;
	/** Disposable store -- auto-cleaned after each test. Pass to helpers that need it. */
	disposables: Pick<DisposableStore, 'add'>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- service stubs are inherently untyped
type ServiceStub = { id: ServiceIdentifier<any>; impl: any };

class PositronTestContainerBuilder {
	private _useRuntimeServices = false;
	private _useWorkbenchServices = false;
	private _stubs: ServiceStub[] = [];

	/** Add the 18 runtime/language services (ILanguageRuntimeService, IRuntimeSessionService, etc.) */
	withRuntimeServices(): this {
		this._useRuntimeServices = true;
		return this;
	}

	/** Add the full 124+ workbench service stack (includes runtime services). */
	withWorkbenchServices(): this {
		this._useWorkbenchServices = true;
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
	 * each test, so the disposable store created by ensureNoLeakedDisposables() is
	 * always initialized before service setup runs.
	 */
	build(): TestContainerResult {
		const disposables = ensureNoLeakedDisposables();
		const stubs = this._stubs;
		const useRuntimeServices = this._useRuntimeServices;
		const useWorkbenchServices = this._useWorkbenchServices;

		// Mutable slot -- reassigned in beforeEach so each test starts fresh.
		let _instantiationService: TestInstantiationService;

		beforeEach(() => {
			if (useWorkbenchServices) {
				_instantiationService = positronWorkbenchInstantiationService(disposables);
			} else if (useRuntimeServices) {
				_instantiationService = new TestInstantiationService(new ServiceCollection());
				createRuntimeServices(_instantiationService, disposables);
			} else {
				_instantiationService = new TestInstantiationService(new ServiceCollection());
			}

			for (const { id, impl } of stubs) {
				_instantiationService.stub(id, impl);
			}
		});

		// Return a result object whose properties delegate to the mutable slot.
		// This is safe because tests only access these after beforeEach has run.
		const result: TestContainerResult = {
			get instantiationService() { return _instantiationService; },
			get: <T>(id: ServiceIdentifier<T>) => _instantiationService.get(id),
			disposables,
		};
		return result;
	}
}

/** Create a test container with fluent builder API. */
export function createTestContainer(): PositronTestContainerBuilder {
	return new PositronTestContainerBuilder();
}
