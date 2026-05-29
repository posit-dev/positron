/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { IContextKeyService, IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { PositronNotebookContextKeyManager } from './ContextKeysManager.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { IPositronNotebookContribution, PositronNotebookExtensionsRegistry } from './positronNotebookExtensions.js';

/**
 * Per-pane presentation state for a Positron notebook.
 *
 * The editor pane creates and owns this object. Each pane that displays the
 * same notebook gets its own view, while the shared `PositronNotebookInstance`
 * remains the model coordinator (execution, cell ordering, kernel, lifecycle).
 *
 * Owns: scoped context key service, scoped instantiation service, context
 * manager, container references, contributions.
 */
export class PositronNotebookView extends Disposable {

	private _scopedContextKeyService: IContextKeyService;
	private _scopedInstantiationService: IInstantiationService;
	private readonly _contextManager: PositronNotebookContextKeyManager;
	private readonly _contributions = this._register(new DisposableMap<string, IPositronNotebookContribution>());

	/** The DOM element that the notebook renders into. */
	readonly container: HTMLElement;

	/** The overlay container for contributions (find widget, etc.). */
	readonly overlayContainer: HTMLElement;

	/** The notebook instance (model) backing this view. */
	get instance(): IPositronNotebookInstance {
		return this._instance;
	}

	get scopedContextKeyService(): IContextKeyService {
		return this._scopedContextKeyService;
	}

	get scopedInstantiationService(): IInstantiationService {
		return this._scopedInstantiationService;
	}

	get contextManager(): PositronNotebookContextKeyManager {
		return this._contextManager;
	}

	constructor(
		private readonly _instance: IPositronNotebookInstance,
		container: HTMLElement,
		overlayContainer: HTMLElement,
		scopedContextKeyService: IScopedContextKeyService,
		editorContainer: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		this.container = container;
		this.overlayContainer = overlayContainer;

		this._scopedContextKeyService = scopedContextKeyService;
		this._scopedInstantiationService = this._instantiationService.createChild(
			new ServiceCollection([IContextKeyService, scopedContextKeyService])
		);

		this._contextManager = this._register(
			this._instantiationService.createInstance(PositronNotebookContextKeyManager, this._instance)
		);
		this._contextManager.setContainer(editorContainer, this._scopedContextKeyService, this._scopedInstantiationService);

		// Instantiate all registered contributions for this view.
		const contributions = PositronNotebookExtensionsRegistry.getNotebookContributions();
		for (const desc of contributions) {
			const contribution = this._scopedInstantiationService.createInstance(desc.ctor, this);
			this._contributions.set(desc.id, contribution);
		}
	}

	/** Gets a registered notebook contribution by its ID. */
	getContribution<T extends IPositronNotebookContribution>(id: string): T | undefined {
		return this._contributions.get(id) as T | undefined;
	}

	/**
	 * Re-attach with the same or different scoped context key service.
	 * Reuses the instantiation service when the CKS hasn't changed (preserves
	 * child DI containers created by cell Monaco editors in the render cache).
	 */
	reattach(
		scopedContextKeyService: IScopedContextKeyService,
		editorContainer: HTMLElement,
	): void {
		if (this._scopedContextKeyService !== scopedContextKeyService) {
			this._scopedContextKeyService = scopedContextKeyService;
			this._scopedInstantiationService = this._instantiationService.createChild(
				new ServiceCollection([IContextKeyService, scopedContextKeyService])
			);
		}
		this._contextManager.setContainer(editorContainer, this._scopedContextKeyService, this._scopedInstantiationService);
	}
}
