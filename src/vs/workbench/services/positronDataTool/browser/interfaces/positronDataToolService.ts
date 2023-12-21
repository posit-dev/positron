/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

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

/**
 * IPositronDataToolInstance interface.
 */
export interface IPositronDataToolInstance {
	/**
	 * Gets the identifier.
	 */
	readonly identifier: string;

	/**
	 * Gets or sets the layout.
	 */
	layout: PositronDataToolLayout;

	/**
	 * Gets or sets the columns width percent.
	 */
	columnsWidthPercent: number;

	/**
	 * Gets or sets the columns scroll offset.
	 */
	columnsScrollOffset: number;

	/**
	 * Gets or sets the rows scroll offset.
	 */
	rowsScrollOffset: number;

	/**
	 * The onDidChangeLayout event.
	 */
	readonly onDidChangeLayout: Event<PositronDataToolLayout>;

	/**
	 * The onDidChangeColumnsWidthPercent event.
	 */
	readonly onDidChangeColumnsWidthPercent: Event<number>;

	/**
	 * The onDidChangeColumnsScrollOffset event.
	 */
	readonly onDidChangeColumnsScrollOffset: Event<number>;

	/**
	 * The onDidChangeRowsScrollOffset event.
	 */
	readonly onDidChangeRowsScrollOffset: Event<number>;
}
