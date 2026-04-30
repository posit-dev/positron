/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';

/**
 * `isAttachedTo()` is the cross-group safety predicate used by
 * PositronNotebookEditor's render-cache eviction. When a tab is moved
 * between editor groups, the workbench opens the editor in the target
 * pane first and closes it in the source pane second. The source pane's
 * cache eviction must NOT detach the shared notebook instance if the
 * target pane has already re-attached it. `isAttachedTo()` returns true
 * only while the instance's container observable still points at the
 * supplied container, giving the eviction path a safe gate.
 */
describe('PositronNotebookInstance.isAttachedTo', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	function getOrCreate(uri: URI): PositronNotebookInstance {
		const instance = PositronNotebookInstance.getOrCreate(
			'test-instance',
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

	it('returns true when the instance is currently attached to the given container', () => {
		const instance = getOrCreate(URI.parse('test:///is-attached-to/attached.ipynb'));
		const container = attachTo(instance);

		expect(instance.isAttachedTo(container)).toBe(true);
	});

	it('returns false for a container the instance has never been attached to', () => {
		const instance = getOrCreate(URI.parse('test:///is-attached-to/unrelated.ipynb'));
		attachTo(instance);

		expect(instance.isAttachedTo(document.createElement('div'))).toBe(false);
	});

	it('returns false for the original container after the instance has been re-attached elsewhere', () => {
		// Simulates the cross-group scenario: target pane re-attaches before
		// the source pane's cache eviction runs.
		const instance = getOrCreate(URI.parse('test:///is-attached-to/re-attached.ipynb'));
		const sourceContainer = attachTo(instance);
		const targetContainer = attachTo(instance);

		expect(instance.isAttachedTo(targetContainer)).toBe(true);
		expect(instance.isAttachedTo(sourceContainer)).toBe(false);
	});

	it('returns false after detachView clears the container', () => {
		const instance = getOrCreate(URI.parse('test:///is-attached-to/detached.ipynb'));
		const container = attachTo(instance);

		instance.detachView();

		expect(instance.isAttachedTo(container)).toBe(false);
	});
});
