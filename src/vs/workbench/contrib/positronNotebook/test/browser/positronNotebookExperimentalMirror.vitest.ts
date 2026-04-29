/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { POSITRON_NOTEBOOK_EXPERIMENTAL_KEY } from '../../common/positronNotebookConfig.js';
import { POSITRON_NOTEBOOK_EXPERIMENTAL } from '../../browser/ContextKeysManager.js';
import { mirrorExperimentalConfigToContextKey } from '../../browser/positronNotebookExperimentalMirror.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';

interface FakeConfigChangeEvent {
	affectsConfiguration: (k: string) => boolean;
	affectedKeys: ReadonlySet<string>;
}

function fakeChangeEvent(affected: string[]): FakeConfigChangeEvent {
	const set = new Set(affected);
	return { affectsConfiguration: (k: string) => set.has(k), affectedKeys: set };
}

describe('mirrorExperimentalConfigToContextKey', () => {
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

	function setupMirror() {
		const contextKeyService = ctx.disposables.add(ctx.instantiationService.createInstance(ContextKeyService));
		ctx.disposables.add(mirrorExperimentalConfigToContextKey(contextKeyService, ctx.get(IConfigurationService)));
		return contextKeyService;
	}

	it('initializes the context key from the current config value', () => {
		configValue = true;
		const contextKeyService = setupMirror();
		expect(POSITRON_NOTEBOOK_EXPERIMENTAL.getValue(contextKeyService)).toBe(true);
	});

	it('updates the context key when configuration changes', () => {
		const contextKeyService = setupMirror();
		expect(POSITRON_NOTEBOOK_EXPERIMENTAL.getValue(contextKeyService)).toBe(false);

		configValue = true;
		configChangeEmitter.fire(fakeChangeEvent([POSITRON_NOTEBOOK_EXPERIMENTAL_KEY]));
		expect(POSITRON_NOTEBOOK_EXPERIMENTAL.getValue(contextKeyService)).toBe(true);
	});

	it('ignores configuration changes that do not affect the experimental key', () => {
		const contextKeyService = setupMirror();

		configValue = true;
		configChangeEmitter.fire(fakeChangeEvent(['some.other.key']));
		expect(POSITRON_NOTEBOOK_EXPERIMENTAL.getValue(contextKeyService)).toBe(false);
	});
});
