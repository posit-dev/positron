/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';

describe('PositronNotebookEditorWidget', () => {
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
		instance.attachWidget(notebookContainer, scopedContextKeyService, overlayContainer, editorContainer);
		return { notebookContainer, editorContainer };
	}

	it('creates a widget on attachWidget', () => {
		const instance = getOrCreate(URI.parse('test:///widget/creates.ipynb'));

		attachTo(instance);

		expect(instance.currentWidget).toBeDefined();
	});

	it('widget has scoped context key service', () => {
		const instance = getOrCreate(URI.parse('test:///widget/has-cks.ipynb'));

		attachTo(instance);

		expect(instance.currentWidget!.scopedContextKeyService).toBeDefined();
	});

	it('widget has scoped instantiation service', () => {
		const instance = getOrCreate(URI.parse('test:///widget/has-insta.ipynb'));

		attachTo(instance);

		expect(instance.currentWidget!.scopedInstantiationService).toBeDefined();
	});

	it('instance scopedContextKeyService redirects through the widget', () => {
		const instance = getOrCreate(URI.parse('test:///widget/redirect-cks.ipynb'));

		attachTo(instance);

		expect(instance.scopedContextKeyService).toBe(instance.currentWidget!.scopedContextKeyService);
	});

	it('instance scopedInstantiationService redirects through the widget', () => {
		const instance = getOrCreate(URI.parse('test:///widget/redirect-insta.ipynb'));

		attachTo(instance);

		expect(instance.scopedInstantiationService).toBe(instance.currentWidget!.scopedInstantiationService);
	});

	it('re-attaching with same container reuses the widget', () => {
		const instance = getOrCreate(URI.parse('test:///widget/reuse.ipynb'));
		const { notebookContainer, editorContainer } = attachTo(instance);
		const firstWidget = instance.currentWidget;

		// Re-attach same container (simulates render cache hit)
		const overlayContainer = document.createElement('div');
		const scopedContextKeyService = ctx.instantiationService.get(IContextKeyService).createScoped(editorContainer);
		instance.attachWidget(notebookContainer, scopedContextKeyService, overlayContainer, editorContainer);

		expect(instance.currentWidget).toBe(firstWidget);
	});

	it('attaching with a different container creates a new widget', () => {
		const instance = getOrCreate(URI.parse('test:///widget/new-container.ipynb'));
		attachTo(instance);
		const firstWidget = instance.currentWidget;

		attachTo(instance);

		expect(instance.currentWidget).not.toBe(firstWidget);
	});

	it('two successive attachWidget calls dispose the first widget', () => {
		const instance = getOrCreate(URI.parse('test:///widget/dispose-old.ipynb'));
		attachTo(instance);
		const firstWidget = instance.currentWidget!;
		const disposeSpy = vi.spyOn(firstWidget, 'dispose');

		attachTo(instance);

		expect(disposeSpy).toHaveBeenCalled();
	});

	it('detachWidget does not dispose the widget (render cache keeps it alive)', () => {
		const instance = getOrCreate(URI.parse('test:///widget/detach-keeps.ipynb'));
		attachTo(instance);
		const widget = instance.currentWidget!;
		const disposeSpy = vi.spyOn(widget, 'dispose');

		instance.detachWidget();

		expect(disposeSpy).not.toHaveBeenCalled();
	});

	it('dispose on instance disposes the widget', () => {
		const uri = URI.parse('test:///widget/instance-dispose.ipynb');
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
		instance.attachWidget(notebookContainer, scopedContextKeyService, overlayContainer, editorContainer);
		const widget = instance.currentWidget!;
		const disposeSpy = vi.spyOn(widget, 'dispose');

		instance.dispose();

		expect(disposeSpy).toHaveBeenCalled();
	});
});
