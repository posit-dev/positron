/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act } from '@testing-library/react';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { CounterEditor } from '../../browser/counterEditor.js';
import { CounterEditorInput } from '../../browser/counterEditorInput.js';
import { CounterService } from '../../browser/counterService.js';
import { ICounterService } from '../../common/counter.js';
import { trackSubscriptions } from './counterTestUtils.js';

describe('CounterEditor', () => {
	const service = new CounterService(new InMemoryStorageService(), new TestConfigurationService());
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICounterService, service)
		.build();

	it('unsubscribes from the store when its input is cleared', async () => {
		// PositronReactRenderer's provider reads the services singleton directly.
		PositronReactServices.services = ctx.reactServices;
		const activeSubscriptions = trackSubscriptions(service);

		const editor = ctx.disposables.add(ctx.instantiationService.createInstance(CounterEditor, stubInterface<IEditorGroup>({})));
		editor.create(document.createElement('div'));
		const input = ctx.disposables.add(new CounterEditorInput());

		await act(() => editor.setInput(input, undefined, {}, CancellationToken.None));
		expect(activeSubscriptions()).toBeGreaterThan(0);

		act(() => editor.clearInput());
		expect(activeSubscriptions()).toBe(0);
	});
});
