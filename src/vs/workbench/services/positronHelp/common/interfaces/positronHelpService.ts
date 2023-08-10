/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

// Create the decorator for the Positron help service (used in dependency injection).
export const IPositronHelpService = createDecorator<IPositronHelpService>('positronHelpService');

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
	readonly onRenderHelp: Event<string | MarkdownString>;

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize(): void;

	// /**
	//  * Opens help HTML.
	//  * @param html The help HTML.
	//  */
	// openHelpHtml(html: string): void;

	// /**
	//  * Opens help markdown.
	//  * @param markdown The help markdown.
	//  */
	// openHelpMarkdown(markdown: MarkdownString): void;

	// /**
	//  * Opens a help URL.
	//  * @param url The help URL.
	//  */
	// openHelpUrl(url: string): void;
}
