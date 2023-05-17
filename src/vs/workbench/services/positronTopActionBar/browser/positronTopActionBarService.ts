/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { ILinkDescriptor } from 'vs/platform/opener/browser/link';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ThemeIcon } from 'vs/base/common/themables';

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
	 * Drives focus to the Positron top action bar.
	 */
	focus(): void;
}
