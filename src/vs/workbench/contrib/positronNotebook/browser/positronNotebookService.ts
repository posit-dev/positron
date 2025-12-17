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
import { Emitter, Event } from '../../../../base/common/event.js';
import { ICellDto2 } from '../../notebook/common/notebookCommon.js';

export const IPositronNotebookService = createDecorator<IPositronNotebookService>('positronNotebookService');
export interface IPositronNotebookService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Event that fires when a new notebook instance is added.
	 */
	readonly onDidAddNotebookInstance: Event<IPositronNotebookInstance>;

	/**
	 * Event that fires when a notebook instance is removed.
	 */
	readonly onDidRemoveNotebookInstance: Event<IPositronNotebookInstance>;

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

	/**
	 * Stores cells in the shared clipboard.
	 * @param cells The cells to store in the clipboard
	 */
	setClipboardCells(cells: ICellDto2[]): void;

	/**
	 * Retrieves cells from the shared clipboard.
	 * @returns The cells currently stored in the clipboard, or empty array if none
	 */
	getClipboardCells(): ICellDto2[];

	/**
	 * Checks if there are cells available in the shared clipboard.
	 * @returns True if cells are available, false otherwise
	 */
	hasClipboardCells(): boolean;

	/**
	 * Clears the shared clipboard.
	 */
	clearClipboard(): void;
}

export class PositronNotebookService extends Disposable implements IPositronNotebookService {

	// Needed for service branding in dependency injector.
	_serviceBrand: undefined;

	//#region Events
	private readonly _onDidAddNotebookInstance = this._register(new Emitter<IPositronNotebookInstance>());
	private readonly _onDidRemoveNotebookInstance = this._register(new Emitter<IPositronNotebookInstance>());
	readonly onDidAddNotebookInstance = this._onDidAddNotebookInstance.event;
	readonly onDidRemoveNotebookInstance = this._onDidRemoveNotebookInstance.event;
	//#endregion Events

	//#region Private Properties
	private _instanceById = new Map<string, IPositronNotebookInstance>();
	private _activeInstance: IPositronNotebookInstance | null = null;
	private _clipboardCells: ICellDto2[] = [];
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
		if (!this._instanceById.has(instance.getId())) {
			this._instanceById.set(instance.getId(), instance);
			this._onDidAddNotebookInstance.fire(instance);
		}
		this._activeInstance = instance;
	}

	public unregisterInstance(instance: IPositronNotebookInstance): void {
		if (this._instanceById.delete(instance.getId())) {
			if (this._activeInstance === instance) {
				this._activeInstance = null;
			}
			this._onDidRemoveNotebookInstance.fire(instance);
		}
	}

	public usingPositronNotebooks(): boolean {
		return utilUsingPositronNotebooks(this._configurationService);
	}

	public setClipboardCells(cells: ICellDto2[]): void {
		this._clipboardCells = cells;
	}

	public getClipboardCells(): ICellDto2[] {
		return this._clipboardCells;
	}

	public hasClipboardCells(): boolean {
		return this._clipboardCells.length > 0;
	}

	public clearClipboard(): void {
		this._clipboardCells = [];
	}
	//#endregion Public Methods
}

// Register the Positron data explorer service.
registerSingleton(IPositronNotebookService, PositronNotebookService, InstantiationType.Delayed);
