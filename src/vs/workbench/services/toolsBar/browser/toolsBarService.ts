/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * Export the service identifier.
 */
export const IToolsBarService = createDecorator<IToolsBarService>('toolsBarService');

/**
 * ToolsBarTopMode enumeration.
 */
export enum ToolsBarTopMode {
	Empty,
	Environment,
	Preview,
	Help
}

/**
 * ToolsBarBottomMode enumeration.
 */
export enum ToolsBarBottomMode {
	Empty,
	Plot,
	Viewer,
	Presentation
}

// IToolsBarService interface.
export interface IToolsBarService {

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
	readonly onDidChangeTopMode: Event<ToolsBarTopMode>;

	/**
	 * An event that is fired when the bottom mode changes.
	 */
	readonly onDidChangeBottomMode: Event<ToolsBarBottomMode>;

	// Other methods.

	focus(): void;
}
