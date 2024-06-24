/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPositronDataExplorerInstance } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance';

// Create the decorator for the Positron data explorer service (used in dependency injection).
export const IPositronDataExplorerService = createDecorator<IPositronDataExplorerService>('positronDataExplorerService');

/**
 * PositronDataExplorerLayout enumeration.
 */
export enum PositronDataExplorerLayout {
	ColumnsLeft = 'ColumnsLeft',
	ColumnsRight = 'ColumnsRight',
	ColumnsHidden = 'ColumnsHidden',
}

/**
 * IPositronDataExplorerService interface.
 */
export interface IPositronDataExplorerService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Gets or sets the active Positron data explorer instance.
	 */
	readonly activePositronDataExplorerInstance?: IPositronDataExplorerInstance;

	/**
	 * Placeholder that gets called to "initialize" the PositronDataExplorerService.
	 */
	initialize(): void;

	/**
	 * Gets the instance for the specified identifier.
	 * @param identifier The instance identifier.
	 */
	getInstance(identifier: string): IPositronDataExplorerInstance | undefined;

	/**
	 * Gets the instance for the specified variable.
	 *
	 * @param variableId The variable identifier.
	 */
	getInstanceForVar(variableId: string): IPositronDataExplorerInstance | undefined;

	/**
	 * Associates a variable with an instance.
	 *
	 * @param instanceId The instance identifier.
	 * @param variableId The variable identifier.
	 */
	setInstanceForVar(instanceId: string, variableId: string): void;

	/**
	 * Sets the focused Positron data explorer.
	 * @param identifier The identifier of the focused Positron data explorer to set.
	 */
	setFocusedPositronDataExplorer(identifier: string): void;

	/**
	 * Clears the focused Positron data explorer.
	 * @param identifier The identifier of the focused Positron data explorer to clear.
	 */
	clearFocusedPositronDataExplorer(identifier: string): void;
}
