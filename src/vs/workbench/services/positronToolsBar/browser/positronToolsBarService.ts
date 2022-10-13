/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * IPositronToolsBarService service identifier.
 */
export const IPositronToolsBarService = createDecorator<IPositronToolsBarService>('positronToolsBarService');

/**
 * PositronToolsBarTopMode enumeration.
 */
export enum PositronToolsBarTopMode {
	Empty,
	Environment,
	Preview,
	Help
}

/**
 * PositronToolsBarBottomMode enumeration.
 */
export enum PositronToolsBarBottomMode {
	Empty,
	Plot,
	Viewer,
	Presentation
}

/**
 * IPositronToolsBarService interface.
 */
export interface IPositronToolsBarService {

	readonly _serviceBrand: undefined;

	/**
	 * Top toggle methods.
	 */
	toggleEnvironment(): void;
	togglePreview(): void;
	toggleHelp(): void;

	/**
	 * Bottom toggle methods.
	 */
	togglePlot(): void;
	toggleViewer(): void;
	togglePresentation(): void;

	/**
	 * Top show methods.
	 */
	showEnvironment(): void;
	showPreview(): void;
	showHelp(): void;

	/**
	 * Bottom show methods.
	 */
	showPlot(): void;
	showViewer(): void;
	showPresentation(): void;

	/**
	 * An event that is fired when the top mode changes.
	 */
	readonly onDidChangeTopMode: Event<PositronToolsBarTopMode>;

	/**
	 * An event that is fired when the bottom mode changes.
	 */
	readonly onDidChangeBottomMode: Event<PositronToolsBarBottomMode>;

	// Other methods.

	focus(): void;
}
