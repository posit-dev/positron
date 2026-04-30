/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { POSITRON_NOTEBOOK_EXPERIMENTAL_KEY } from '../../common/positronNotebookConfig.js';
import { PositronNotebookService } from '../../browser/positronNotebookService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';

describe('PositronNotebookService experimental gate', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IConfigurationService, {
			getValue: (key: string) => key === POSITRON_NOTEBOOK_EXPERIMENTAL_KEY ? true : undefined,
			onDidChangeConfiguration: Event.None,
		})
		.build();

	it('mirrors experimental config to observable', () => {
		const service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronNotebookService));
		expect(service.experimentsEnabled.get()).toBe(true);
	});
});
