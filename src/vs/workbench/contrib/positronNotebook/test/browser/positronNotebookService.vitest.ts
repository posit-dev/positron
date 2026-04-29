/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { POSITRON_NOTEBOOK_EXPERIMENTAL_KEY } from '../../common/positronNotebookConfig.js';
import { PositronNotebookService } from '../../browser/positronNotebookService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';

interface FakeConfigChangeEvent {
	affectsConfiguration: (k: string) => boolean;
	affectedKeys: ReadonlySet<string>;
}

function fakeChangeEvent(affected: string[]): FakeConfigChangeEvent {
	const set = new Set(affected);
	return { affectsConfiguration: (k: string) => set.has(k), affectedKeys: set };
}

describe('PositronNotebookService.experimentsEnabled', () => {
	let configValue = false;
	const configChangeEmitter = new Emitter<FakeConfigChangeEvent>();

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IConfigurationService, {
			getValue: (key: string) => key === POSITRON_NOTEBOOK_EXPERIMENTAL_KEY ? configValue : undefined,
			onDidChangeConfiguration: configChangeEmitter.event,
		})
		.build();

	beforeEach(() => {
		configValue = false;
	});

	function createService() {
		return ctx.disposables.add(ctx.instantiationService.createInstance(PositronNotebookService));
	}

	it('reads the current configuration value', () => {
		configValue = true;
		const service = createService();
		expect(service.experimentsEnabled.get()).toBe(true);
	});

	it('updates when the experimental configuration key changes', () => {
		const service = createService();
		expect(service.experimentsEnabled.get()).toBe(false);

		configValue = true;
		configChangeEmitter.fire(fakeChangeEvent([POSITRON_NOTEBOOK_EXPERIMENTAL_KEY]));
		expect(service.experimentsEnabled.get()).toBe(true);
	});
});
