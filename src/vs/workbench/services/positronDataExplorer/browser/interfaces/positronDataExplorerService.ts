/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
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
	 * Placeholder that gets called to "initialize" the PositronDataExplorerService.
	 */
	initialize(): void;

	/**
	 * Test open function.
	 * @param identifier The identifier.
	 */
	testOpen(identifier: string): Promise<void>;

	/**
	 * Associates a variable with an instance.
	 *
	 * @param instanceId The instance identifier.
	 * @param variableId The variable identifier.
	 */
	setInstanceForVar(instanceId: string, variableId: string): void;

	/**
	 * Gets the instance for the specified variable.
	 *
	 * @param variableId The variable identifier.
	 */
	getInstanceForVar(variableId: string): IPositronDataExplorerInstance | undefined;

	/**
	 * Gets the instance for the specified identifier.
	 *
	 * @param identifier
	 */
	getInstance(identifier: string): IPositronDataExplorerInstance | undefined;
}
