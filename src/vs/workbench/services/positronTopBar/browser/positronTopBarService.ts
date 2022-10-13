/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { ILinkDescriptor } from 'vs/platform/opener/browser/link';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * IPositronTopBarItem interface.
 */
export interface IPositronTopBarItem {
	readonly id: string;
	readonly icon: ThemeIcon | URI | undefined;
	readonly message: string | MarkdownString;
	readonly actions?: ILinkDescriptor[];
	readonly ariaLabel?: string;
	readonly onClose?: () => void;
}

/**
 * IPositronTopBarService service identifier.
 */
export const IPositronTopBarService = createDecorator<IPositronTopBarService>('positronTopBarService');

/**
 * IPositronTopBarService interface.
 */
export interface IPositronTopBarService {

	readonly _serviceBrand: undefined;

	focus(): void;
}
