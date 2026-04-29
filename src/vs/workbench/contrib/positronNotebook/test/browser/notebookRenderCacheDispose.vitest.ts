/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { PositronReactRenderer } from '../../../../../base/browser/positronReactRenderer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ICachedNotebookRender } from '../../browser/notebookRenderCache.js';
import { disposeNotebookRenderCacheEntry } from '../../browser/notebookRenderCacheDispose.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';

/**
 * Tests for the notebook render-cache eviction policy. This is the callback
 * the per-pane cache hands to NotebookRenderCache, so it covers the wiring
 * the editor relies on for tab-switch and cross-group safety.
 */
describe('disposeNotebookRenderCacheEntry', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	function makeEntry(name: string, container: HTMLElement = document.createElement('div')): ICachedNotebookRender {
		return {
			uri: URI.parse(`test:///dispose/${name}.ipynb`),
			container,
			renderer: stubInterface<PositronReactRenderer>({ dispose: vi.fn() }),
		};
	}

	function attachInstance(uri: URI, container: HTMLElement): PositronNotebookInstance {
		const instance = PositronNotebookInstance.getOrCreate(
			'test-instance',
			uri,
			'jupyter-notebook',
			undefined,
			ctx.instantiationService,
		);
		ctx.disposables.add(instance);
		const overlayContainer = document.createElement('div');
		const editorContainer = document.createElement('div');
		const scopedContextKeyService = ctx.instantiationService.get(IContextKeyService).createScoped(editorContainer);
		instance.attachView(container, scopedContextKeyService, overlayContainer, editorContainer);
		return instance;
	}

	it('disposes the entry renderer and removes the container from the DOM', () => {
		const entry = makeEntry('renderer-and-dom');
		document.body.appendChild(entry.container);

		disposeNotebookRenderCacheEntry(entry);

		expect(entry.renderer.dispose).toHaveBeenCalled();
		expect(entry.container.parentElement).toBeNull();
	});

	it('detaches the shared notebook instance when still attached to the entry container', () => {
		const entry = makeEntry('detach-when-attached');
		const instance = attachInstance(entry.uri, entry.container);
		expect(instance.container.get()).toBe(entry.container);

		disposeNotebookRenderCacheEntry(entry);

		expect(instance.container.get()).toBeUndefined();
	});

	it('does not detach when the shared instance has been re-attached to a different container', () => {
		// Source pane attached the shared instance and cached this entry.
		const sourceContainer = document.createElement('div');
		const entry = makeEntry('no-detach-after-reattach', sourceContainer);
		const instance = attachInstance(entry.uri, sourceContainer);

		// Target pane re-attached the same shared instance to its own container.
		const targetContainer = document.createElement('div');
		const overlayContainer = document.createElement('div');
		const editorContainer = document.createElement('div');
		const scopedContextKeyService = ctx.instantiationService.get(IContextKeyService).createScoped(editorContainer);
		instance.attachView(targetContainer, scopedContextKeyService, overlayContainer, editorContainer);
		expect(instance.container.get()).toBe(targetContainer);

		// Source pane's eviction must NOT detach -- the target is using the instance.
		disposeNotebookRenderCacheEntry(entry);

		expect(instance.container.get()).toBe(targetContainer);
	});

	it('is a no-op detach when no instance is registered for the entry URI', () => {
		const entry = makeEntry('no-instance');

		expect(() => disposeNotebookRenderCacheEntry(entry)).not.toThrow();
		expect(entry.renderer.dispose).toHaveBeenCalled();
	});
});
