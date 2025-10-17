/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { usingPositronNotebooks as utilUsingPositronNotebooks } from '../common/positronNotebookCommon.js';
import { isEqual } from '../../../../base/common/resources.js';

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
	 * @param uri The optional notebook URI to filter instances by.
	 */
	listInstances(uri?: URI): Array<IPositronNotebookInstance>;

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
	 * Check if Positron notebooks are configured as the default editor for .ipynb files
	 * @returns true if Positron notebooks are the default editor, false otherwise
	 */
	usingPositronNotebooks(): boolean;
}

class PositronNotebookService extends Disposable implements IPositronNotebookService {

	// Needed for service branding in dependency injector.
	_serviceBrand: undefined;

	//#region Private Properties
	private _instanceById = new Map<string, IPositronNotebookInstance>();
	private _activeInstance: IPositronNotebookInstance | null = null;
	//#endregion Private Properties

	//#region Constructor & Dispose
	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
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

	public listInstances(uri?: URI): Array<IPositronNotebookInstance> {
		let instances = Array.from(this._instanceById.values());
		if (uri) {
			instances = instances.filter(instance => isEqual(instance.uri, uri));
		}
		return instances;
	}

	public registerInstance(instance: IPositronNotebookInstance): void {
		if (!this._instanceById.has(instance.id)) {
			this._instanceById.set(instance.id, instance);
		}
		this._activeInstance = instance;
	}

	public unregisterInstance(instance: IPositronNotebookInstance): void {
		this._instanceById.delete(instance.id);
		if (this._activeInstance === instance) {
			this._activeInstance = null;
		}
	}

	public usingPositronNotebooks(): boolean {
		return utilUsingPositronNotebooks(this._configurationService);
	}
	//#endregion Public Methods
}

// Register the Positron data explorer service.
registerSingleton(IPositronNotebookService, PositronNotebookService, InstantiationType.Delayed);
