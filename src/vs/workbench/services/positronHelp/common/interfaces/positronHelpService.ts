/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

// Create the decorator for the Positron help service (used in dependency injection).
export const IPositronHelpService = createDecorator<IPositronHelpService>('positronHelpService');

/**
 * HelpDescriptor interface. Describes a help topic to be opened for the user.
 */
export interface HelpDescriptor {
	languageId: string;
	runtimeId: string;
	languageName: string;
	sourceUrl: string;
	targetUrl: string;
	focus: boolean;
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
	readonly onRenderHelp: Event<HelpDescriptor>;

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize(): void;
}
