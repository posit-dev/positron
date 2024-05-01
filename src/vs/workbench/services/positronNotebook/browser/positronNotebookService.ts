/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IAction2Options } from 'vs/platform/actions/common/actions';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPositronNotebookInstance } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookInstance';

export const IPositronNotebookService = createDecorator<IPositronNotebookService>('positronNotebookService');
export interface IPositronNotebookService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Placeholder that gets called to "initialize" the PositronNotebookService.
	 */
	initialize(): void;

	/**
	 * Get all notebook instances currently running.
	 */
	getInstances(): Set<IPositronNotebookInstance>;

	/**
	 * Get the currently active notebook instance, if it exists.
	 */
	getActiveInstance(): IPositronNotebookInstance | null;

	/**
	 * Register a new notebook instance.
	 * @param instance The instance to register.
	 */
	registerInstance(instance: IPositronNotebookInstance): void;

	/**
	 * Unregister a notebook instance.
	 * @param instance The instance to unregister.
	 */
	unregisterInstance(instance: IPositronNotebookInstance): void;

	/**
	 * Dispatch an action to appropriate notebook instance.
	 * @param desc The action to dispatch info.
	 */
	dispatchAction(desc: IAction2Options): void;
}

class PositronNotebookService extends Disposable implements IPositronNotebookService {

	// Needed for service branding in dependency injector.
	_serviceBrand: undefined;

	//#region Private Properties
	private _instances = new Set<IPositronNotebookInstance>();
	private _activeInstance: IPositronNotebookInstance | null = null;
	//#endregion Private Properties

	//#region Constructor & Dispose
	constructor() {
		// Call the disposable constrcutor.
		super();
	}

	public override dispose(): void {
		super.dispose();
	}
	//#endregion Constructor & Dispose

	//#region Public Methods
	public initialize(): void {
		// Placeholder.
	}

	public getInstances(): Set<IPositronNotebookInstance> {
		return this._instances;
	}

	public getActiveInstance(): IPositronNotebookInstance | null {
		return this._activeInstance;
	}

	public registerInstance(instance: IPositronNotebookInstance): void {
		this._instances.add(instance);
		this._activeInstance = instance;
	}

	public unregisterInstance(instance: IPositronNotebookInstance): void {
		this._instances.delete(instance);
		if (this._activeInstance === instance) {
			this._activeInstance = null;
		}
	}

	public dispatchAction(desc: IAction2Options): void {
		console.log('Dispatching action:', desc);
		if (!this._activeInstance) { return; }

		switch (desc.id) {
			case 'notebook.cell.insertCodeCellAboveAndFocusContainer':
				this._activeInstance.insertCodeCellAboveAndFocusContainer();
				break;
			default:
				console.log('Unknown action:', desc);
				break;
		}
	}
	//#endregion Public Methods
}

// Register the Positron data explorer service.
registerSingleton(IPositronNotebookService, PositronNotebookService, InstantiationType.Delayed);
