/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';

describe('PositronNotebookInstance.getOrCreate', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	function getOrCreate(uri: URI, instanceId: string = 'test-instance'): PositronNotebookInstance {
		const instance = PositronNotebookInstance.getOrCreate(
			instanceId,
			uri,
			'jupyter-notebook',
			undefined,
			ctx.instantiationService,
		);
		ctx.disposables.add(instance);
		return instance;
	}

	function attachTo(instance: PositronNotebookInstance): HTMLElement {
		const notebookContainer = document.createElement('div');
		const overlayContainer = document.createElement('div');
		const editorContainer = document.createElement('div');
		const scopedContextKeyService = ctx.instantiationService.get(IContextKeyService).createScoped(editorContainer);
		instance.attachView(notebookContainer, scopedContextKeyService, overlayContainer, editorContainer);
		return notebookContainer;
	}

	it('creates a new instance when no instance exists for the URI', () => {
		const uri = URI.parse('test:///get-or-create/fresh.ipynb');

		const instance = getOrCreate(uri);

		expect(instance.uri.toString()).toBe(uri.toString());
	});

	it('returns the same instance on a second call for the same URI even when the caller passes a different id', () => {
		const uri = URI.parse('test:///get-or-create/same-uri.ipynb');

		const first = getOrCreate(uri, 'test-id-first');
		const second = getOrCreate(uri, 'test-id-second');

		expect(second).toBe(first);
	});

	it('does not detach an already-attached instance when reused for the same URI under a different id', () => {
		const uri = URI.parse('test:///get-or-create/no-detach.ipynb');
		const instance = getOrCreate(uri, 'test-id-attached');
		const container = attachTo(instance);
		expect(instance.container.get()).toBe(container);

		getOrCreate(uri, 'test-id-reused');

		expect(instance.container.get()).toBe(container);
	});
});
