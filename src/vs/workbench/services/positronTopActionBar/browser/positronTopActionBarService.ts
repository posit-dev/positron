/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { ILinkDescriptor } from 'vs/platform/opener/browser/link';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
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

	readonly _serviceBrand: undefined;

	focus(): void;
}
