/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';
import { positronNotebookInstantiationService } from './testPositronNotebookInstance.js';

describe('PositronNotebookInstance.getOrCreate', () => {
	const ctx = createTestContainer().build();

	it('does not detach an already-attached instance when reused for the same URI', () => {
		const disposables = new DisposableStore();
		ctx.disposables.add(disposables);
		const instantiationService = positronNotebookInstantiationService(disposables);

		const uri = URI.parse('test:///get-or-create/same-uri.ipynb');
		const instance = PositronNotebookInstance.getOrCreate(
			'test-get-or-create-1',
			uri,
			'jupyter-notebook',
			undefined,
			instantiationService,
		);
		disposables.add(instance);

		// Attach to a container, simulating the pane's setInput flow.
		const notebookContainer = document.createElement('div');  // becomes instance.container
		const overlayContainer = document.createElement('div');
		const editorContainer = document.createElement('div');    // for contextManager
		const scopedContextKeyService = instantiationService.get(IContextKeyService).createScoped(editorContainer);
		instance.attachView(notebookContainer, scopedContextKeyService, overlayContainer, editorContainer);

		expect(instance.container.get()).toBe(notebookContainer);

		// Second getOrCreate for the same URI should return the same instance
		// without detaching it.
		const second = PositronNotebookInstance.getOrCreate(
			'test-get-or-create-2',
			uri,
			'jupyter-notebook',
			undefined,
			instantiationService,
		);

		expect(second).toBe(instance);
		expect(instance.container.get()).toBe(notebookContainer);
	});
});
