/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';

describe('PositronNotebookView', () => {
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

	function attachTo(instance: PositronNotebookInstance): { notebookContainer: HTMLElement; editorContainer: HTMLElement } {
		const notebookContainer = document.createElement('div');
		const overlayContainer = document.createElement('div');
		const editorContainer = document.createElement('div');
		const scopedContextKeyService = ctx.instantiationService.get(IContextKeyService).createScoped(editorContainer);
		instance.attachView(notebookContainer, scopedContextKeyService, overlayContainer, editorContainer);
		return { notebookContainer, editorContainer };
	}

	it('creates a view on attachView', () => {
		const instance = getOrCreate(URI.parse('test:///view/creates.ipynb'));

		attachTo(instance);

		expect(instance.currentView).toBeDefined();
	});

	it('view has scoped context key service', () => {
		const instance = getOrCreate(URI.parse('test:///view/has-cks.ipynb'));

		attachTo(instance);

		expect(instance.currentView!.scopedContextKeyService).toBeDefined();
	});

	it('view has scoped instantiation service', () => {
		const instance = getOrCreate(URI.parse('test:///view/has-insta.ipynb'));

		attachTo(instance);

		expect(instance.currentView!.scopedInstantiationService).toBeDefined();
	});

	it('instance scopedContextKeyService redirects through the view', () => {
		const instance = getOrCreate(URI.parse('test:///view/redirect-cks.ipynb'));

		attachTo(instance);

		expect(instance.scopedContextKeyService).toBe(instance.currentView!.scopedContextKeyService);
	});

	it('instance scopedInstantiationService redirects through the view', () => {
		const instance = getOrCreate(URI.parse('test:///view/redirect-insta.ipynb'));

		attachTo(instance);

		expect(instance.scopedInstantiationService).toBe(instance.currentView!.scopedInstantiationService);
	});

	it('re-attaching with same container reuses the view', () => {
		const instance = getOrCreate(URI.parse('test:///view/reuse.ipynb'));
		const { notebookContainer, editorContainer } = attachTo(instance);
		const firstView = instance.currentView;

		// Re-attach same container (simulates render cache hit)
		const overlayContainer = document.createElement('div');
		const scopedContextKeyService = ctx.instantiationService.get(IContextKeyService).createScoped(editorContainer);
		instance.attachView(notebookContainer, scopedContextKeyService, overlayContainer, editorContainer);

		expect(instance.currentView).toBe(firstView);
	});

	it('attaching with a different container creates a new view', () => {
		const instance = getOrCreate(URI.parse('test:///view/new-container.ipynb'));
		attachTo(instance);
		const firstView = instance.currentView;

		attachTo(instance);

		expect(instance.currentView).not.toBe(firstView);
	});

	it('two successive attachView calls dispose the first view', () => {
		const instance = getOrCreate(URI.parse('test:///view/dispose-old.ipynb'));
		attachTo(instance);
		const firstView = instance.currentView!;
		const disposeSpy = vi.spyOn(firstView, 'dispose');

		attachTo(instance);

		expect(disposeSpy).toHaveBeenCalled();
	});

	it('detachView does not dispose the view (render cache keeps it alive)', () => {
		const instance = getOrCreate(URI.parse('test:///view/detach-keeps.ipynb'));
		attachTo(instance);
		const view = instance.currentView!;
		const disposeSpy = vi.spyOn(view, 'dispose');

		instance.detachView();

		expect(disposeSpy).not.toHaveBeenCalled();
	});

	it('dispose on instance disposes the view', () => {
		const uri = URI.parse('test:///view/instance-dispose.ipynb');
		const instance = PositronNotebookInstance.getOrCreate(
			'test-instance',
			uri,
			'jupyter-notebook',
			undefined,
			ctx.instantiationService,
		);
		const notebookContainer = document.createElement('div');
		const overlayContainer = document.createElement('div');
		const editorContainer = document.createElement('div');
		const scopedContextKeyService = ctx.instantiationService.get(IContextKeyService).createScoped(editorContainer);
		instance.attachView(notebookContainer, scopedContextKeyService, overlayContainer, editorContainer);
		const view = instance.currentView!;
		const disposeSpy = vi.spyOn(view, 'dispose');

		instance.dispose();

		expect(disposeSpy).toHaveBeenCalled();
	});
});
