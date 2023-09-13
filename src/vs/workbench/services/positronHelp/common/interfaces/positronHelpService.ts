/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

// Create the decorator for the Positron help service (used in dependency injection).
export const IPositronHelpService = createDecorator<IPositronHelpService>('positronHelpService');

/**
 * The Positron help view ID.
 */
export const POSITRON_HELP_VIEW_ID = 'workbench.panel.positronHelp';

/**
 * HelpEntry interface.
 */
export interface HelpEntry {
	languageId: string;
	runtimeId: string;
	languageName: string;
	sourceUrl: string;
	targetUrl: string;
	title?: string;
}

/**
 * IPositronHelpService interface.
 */
export interface IPositronHelpService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * The onFocusHelp event.
	 */
	readonly onFocusHelp: Event<void>;

	/**
	 * The onDidChangeCurrentHelpEntry event.
	 */
	readonly onDidChangeCurrentHelpEntry: Event<HelpEntry | undefined>;

	/**
	 * The onHelpLoaded event.
	 */
	readonly onHelpLoaded: Event<HelpEntry>;

	/**
	 * Gets the help history.
	 */
	readonly helpHistory: HelpEntry[];

	/**
	 * Gets the current help entry.
	 */
	readonly currentHelpEntry?: HelpEntry;

	/**
	 * Gets a value which indicates whether help can navigate backward.
	 */
	readonly canNavigateBackward: boolean;

	/**
	 * Gets a value which indicates whether help can navigate forward.
	 */
	readonly canNavigateForward: boolean;

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize(): void;

	/**
	 * Opens the specified help entry.
	 * @param helpEntry The help entry to open.
	 */
	openHelpEntry(helpEntry: HelpEntry): void;

	/**
	 * Navigates the help service.
	 * @param fromUrl The from URL.
	 * @param toUrl The to URL.
	 */
	navigate(fromUrl: string, toUrl: string): void;

	/**
	 * Navigates backward.
	 */
	navigateBackward(): void;

	/**
	 * Navigates forward.
	 */
	navigateForward(): void;

	/**
	 * Called to indicate that help has loaded.
	 * @param url The URL of the help that was loaded.
	 * @param title The title of the help that was loaded.
	 */
	helpLoaded(url: string, title: string): Promise<void>;
}
