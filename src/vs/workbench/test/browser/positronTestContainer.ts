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
type ServiceStub = { id: ServiceIdentifier<any>; impl: unknown };

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

	/** Build the container. Returns get(), instantiationService, and disposables. */
	build(): TestContainerResult {
		const disposables = ensureNoLeakedDisposables();

		let instantiationService: TestInstantiationService;

		if (this._useWorkbenchServices) {
			instantiationService = positronWorkbenchInstantiationService(disposables);
		} else if (this._useRuntimeServices) {
			instantiationService = new TestInstantiationService(new ServiceCollection());
			createRuntimeServices(instantiationService, disposables);
		} else {
			instantiationService = new TestInstantiationService(new ServiceCollection());
		}

		for (const { id, impl } of this._stubs) {
			instantiationService.stub(id, impl);
		}

		return {
			get: <T>(id: ServiceIdentifier<T>) => instantiationService.get(id),
			instantiationService,
			disposables,
		};
	}
}

/** Create a test container with fluent builder API. */
export function createTestContainer(): PositronTestContainerBuilder {
	return new PositronTestContainerBuilder();
}
