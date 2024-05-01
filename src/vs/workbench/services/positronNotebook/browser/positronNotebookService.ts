/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';

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
	getInstances(): IPositronNotebookInstance[];

	/**
	 * Get the currently active notebook instance, if it exists.
	 */
	getActiveInstance(): IPositronNotebookInstance | null;

	/**
	 * Testing to see if things are working
	 */
	sayHi(): void;
}

class PositronNotebookService extends Disposable implements IPositronNotebookService {

	// Needed for service branding in dependency injector.
	_serviceBrand: undefined;

	//#region Private Properties
	private _instances: IPositronNotebookInstance[] = [];
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

	public getInstances(): IPositronNotebookInstance[] {
		return this._instances;
	}

	public getActiveInstance(): IPositronNotebookInstance | null {
		return this._activeInstance;
	}

	public sayHi(): void {
		console.log('Hi from PositronNotebookService!');
	}
	//#endregion Public Methods
}

// Register the Positron data explorer service.
registerSingleton(IPositronNotebookService, PositronNotebookService, InstantiationType.Delayed);
