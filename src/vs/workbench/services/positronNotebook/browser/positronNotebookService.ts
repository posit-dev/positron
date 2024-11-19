/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';

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
	 * Get instance by resource if it exists.
	 */
	getInstance(resource: URI): IPositronNotebookInstance | undefined;
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
		if (!this._instances.has(instance)) {
			this._instances.add(instance);
		}
		this._activeInstance = instance;
	}

	public unregisterInstance(instance: IPositronNotebookInstance): void {
		this._instances.delete(instance);
		if (this._activeInstance === instance) {
			this._activeInstance = null;
		}
	}

	public getInstance(resource: URI): IPositronNotebookInstance | undefined {
		for (const instance of this._instances) {
			if (instance.uri.toString() === resource.toString()) {
				return instance;
			}
		}
		return undefined;
	}
	//#endregion Public Methods
}

// Register the Positron data explorer service.
registerSingleton(IPositronNotebookService, PositronNotebookService, InstantiationType.Delayed);
