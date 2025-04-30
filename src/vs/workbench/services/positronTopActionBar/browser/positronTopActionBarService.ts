/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { ILinkDescriptor } from '../../../../platform/opener/browser/link.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

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
