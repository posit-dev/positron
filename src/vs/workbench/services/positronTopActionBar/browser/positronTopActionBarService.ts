/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { ThemeIcon } from 'vs/base/common/themables';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { ILinkDescriptor } from 'vs/platform/opener/browser/link';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * IPositronTopActionBarItem interface.
 */
export interface IPositronTopActionBarItem {
	readonly id: string;
	readonly icon: ThemeIcon | URI | undefined;
	readonly message: string | MarkdownString;
	readonly actions?: ILinkDescriptor[];
	readonly ariaLabel?: string;
	readonly onClose?: () => void;
}

/**
 * IPositronTopActionBarService service identifier.
 */
export const IPositronTopActionBarService = createDecorator<IPositronTopActionBarService>('positronTopActionBarService');

/**
 * IPositronTopActionBarService interface.
 */
export interface IPositronTopActionBarService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * The onShowStartInterpreterPopup event.
	 */
	readonly onShowStartInterpreterPopup: Event<void>;

	/**
	 * Drives focus to the Positron top action bar.
	 */
	focus(): void;

	/**
	 * Shows the start interpreter popup.
	 */
	showStartInterpreterPopup(): void;
}
