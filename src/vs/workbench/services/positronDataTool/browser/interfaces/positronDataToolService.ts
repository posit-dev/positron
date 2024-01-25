/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPositronDataToolInstance } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolInstance';

// Create the decorator for the Positron data tool service (used in dependency injection).
export const IPositronDataToolService = createDecorator<IPositronDataToolService>('positronDataToolService');

/**
 * PositronDataToolLayout enumeration.
 */
export enum PositronDataToolLayout {
	ColumnsLeft = 'ColumnsLeft',
	ColumnsRight = 'ColumnsRight',
	ColumnsHidden = 'ColumnsHidden',
}

/**
 * IPositronDataToolService interface.
 */
export interface IPositronDataToolService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Placeholder that gets called to "initialize" the PositronDataToolService.
	 */
	initialize(): void;

	/**
	 * Test open function.
	 * @param identifier The identifier.
	 */
	testOpen(identifier: string): Promise<void>;

	/**
	 *
	 * @param identifier
	 */
	getInstance(identifier: string): IPositronDataToolInstance | undefined;
}
