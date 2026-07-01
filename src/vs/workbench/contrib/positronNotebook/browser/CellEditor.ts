/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../base/browser/dom.js';
import { IDisposable, Disposable } from '../../../../base/common/lifecycle.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { IContextKeyService, IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IEditorProgressService } from '../../../../platform/progress/common/progress.js';

export class CellEditor extends Disposable {
	/**
	 * The editor's DOM node. The editor owns its node (rather than React)
	 * so that it can be reparented to another React component.
	 */
	public readonly element: HTMLElement;

	public readonly scopedContextKeyService: IScopedContextKeyService;

	public readonly scopedInstantiationService: IInstantiationService;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();

		// Create the editor's DOM node.
		this.element = $('.positron-cell-editor-monaco-widget');
		this.element.className = 'positron-cell-editor-monaco-widget';
		this.element.tabIndex = -1;

		// Create a scoped context key service for this editor as a child of the cell's scope.
		// This ensures cell-level context keys (e.g. positronNotebookCellIsFirst) are visible
		// to menus evaluated inside the editor. CodeEditorWidget will create its own child scope
		// from this one for editor-specific keys.
		this.scopedContextKeyService = this._register(contextKeyService.createScoped(this.element));

		// CRITICAL: Set the inCompositeEditor flag to change editor behavior
		// This tells Monaco it's part of a composite (notebook) and not a standalone editor
		// Without this flag, certain standalone editor keybindings would still fire
		EditorContextKeys.inCompositeEditor.bindTo(this.scopedContextKeyService).set(true);

		// We need to ensure the EditorProgressService (or a fake) is available
		// in the service collection because monaco editors will try and access
		// it even though it's not available in the notebook context. This feels
		// hacky but VSCode notebooks do the same thing so I guess it's easier
		// than fixing it at the monaco level.
		const serviceCollection = new ServiceCollection(
			[
				IEditorProgressService,
				// Create a simple no-op IEditorProgressService for editor contributions
				// Based on pattern from codeBlockPart.ts in chat contrib
				new class implements IEditorProgressService {
					_serviceBrand: undefined;
					show() {
						// No-op progress indicator for notebook cell editors
						return { done: () => { }, total: () => { }, worked: () => { } };
					}
					async showWhile(promise: Promise<unknown>): Promise<void> {
						await promise;
					}
				}],
			[IContextKeyService, this.scopedContextKeyService]
		);
		this.scopedInstantiationService = instantiationService.createChild(serviceCollection);
	}

	/**
	 * Register a disposable to be disposed with the cell editor.
	 */
	register<T extends IDisposable>(disposable: T): T {
		return this._register(disposable);
	}
}
