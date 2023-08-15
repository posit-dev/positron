/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

// Create the decorator for the Positron help service (used in dependency injection).
export const IPositronHelpService = createDecorator<IPositronHelpService>('positronHelpService');

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
	 * The onRenderHelp event.
	 */
	readonly onRenderHelp: Event<HelpEntry>;

	/**
	 * The onFocusHelp event.
	 */
	readonly onFocusHelp: Event<void>;

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize(): void;

	/**
	 * Sets the title.
	 * @param fromUrl
	 * @param title
	 */
	setTitle(fromUrl: string, title: string): void;

	/**
	 * Navigates the help service.
	 * @param fromUrl The from URL.
	 * @param toUrl The to URL.
	 */
	navigate(fromUrl: string, toUrl: string): void;

	/**
	 * Navigates back.
	 */
	navigateBack(): void;

	/**
	 * Navigates forward.
	 */
	navigateForward(): void;
}
