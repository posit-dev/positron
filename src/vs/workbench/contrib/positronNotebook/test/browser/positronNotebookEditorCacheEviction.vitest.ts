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

/**
 * These tests verify the cross-group safety of the per-pane render cache
 * eviction logic in PositronNotebookEditor. Specifically: if a tab is moved
 * between editor groups, the workbench opens the editor in the target first
 * and closes it in the source second. If the source pane's eviction tears
 * down the shared PositronNotebookInstance after the target has re-attached,
 * the destination view breaks.
 *
 * The guard: only call instance.detachView() if the instance's container
 * observable still points at this cache entry's container.
 */
describe('PositronNotebookEditor cache eviction (cross-group safety)', () => {
	const ctx = createTestContainer().build();

	/**
	 * Mirrors the shape of the guard used by
	 * PositronNotebookEditor._disposeCachedRender. Calls the same
	 * PositronNotebookInstance.isAttachedTo() method the production path
	 * uses, so the test cannot silently drift away from production logic.
	 */
	function evictEntry(entry: { uri: URI; container: HTMLElement }): void {
		const instance = PositronNotebookInstance._instanceMap.get(entry.uri);
		if (instance && instance.isAttachedTo(entry.container)) {
			instance.detachView();
		}
	}

	it('calls detachView when the shared instance is still attached to this entry', () => {
		const disposables = new DisposableStore();
		ctx.disposables.add(disposables);
		const instantiationService = positronNotebookInstantiationService(disposables);

		const uri = URI.parse('test:///cache-eviction/same-container.ipynb');
		const instance = disposables.add(PositronNotebookInstance.getOrCreate(
			'test-cache-same',
			uri,
			'jupyter-notebook',
			undefined,
			instantiationService,
		));

		const notebookContainer = document.createElement('div');
		const overlayContainer = document.createElement('div');
		const editorContainer = document.createElement('div');
		const scopedContextKeyService = instantiationService.get(IContextKeyService).createScoped(editorContainer);
		instance.attachView(notebookContainer, scopedContextKeyService, overlayContainer, editorContainer);

		expect(instance.container.get()).toBe(notebookContainer);

		evictEntry({ uri, container: notebookContainer });

		// detachView was called on this container -- the observable is now undefined.
		expect(instance.container.get()).toBeUndefined();
	});

	it('does NOT call detachView when the shared instance has been re-attached to a different container', () => {
		const disposables = new DisposableStore();
		ctx.disposables.add(disposables);
		const instantiationService = positronNotebookInstantiationService(disposables);

		const uri = URI.parse('test:///cache-eviction/different-container.ipynb');
		const instance = disposables.add(PositronNotebookInstance.getOrCreate(
			'test-cache-different',
			uri,
			'jupyter-notebook',
			undefined,
			instantiationService,
		));

		// Source pane's original container: this is what the cache entry remembers.
		const sourceNotebookContainer = document.createElement('div');
		const sourceOverlayContainer = document.createElement('div');
		const sourceEditorContainer = document.createElement('div');
		const sourceScopedContextKeyService = instantiationService.get(IContextKeyService).createScoped(sourceEditorContainer);
		instance.attachView(sourceNotebookContainer, sourceScopedContextKeyService, sourceOverlayContainer, sourceEditorContainer);

		// Target pane re-attaches the shared instance to its own container
		// (simulates the target's setInput firing before the source's eviction).
		const targetNotebookContainer = document.createElement('div');
		const targetOverlayContainer = document.createElement('div');
		const targetEditorContainer = document.createElement('div');
		const targetScopedContextKeyService = instantiationService.get(IContextKeyService).createScoped(targetEditorContainer);
		instance.attachView(targetNotebookContainer, targetScopedContextKeyService, targetOverlayContainer, targetEditorContainer);

		expect(instance.container.get()).toBe(targetNotebookContainer);

		// Source pane now evicts its cache entry. It must NOT detach the
		// shared instance because the target is now using it.
		evictEntry({ uri, container: sourceNotebookContainer });

		expect(instance.container.get()).toBe(targetNotebookContainer);
	});
});
