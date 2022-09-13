/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from 'vs/base/common/htmlContent';
import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILinkDescriptor } from 'vs/platform/opener/browser/link';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';

export interface ITopBarItem {
	readonly id: string;
	readonly icon: ThemeIcon | URI | undefined;
	readonly message: string | MarkdownString;
	readonly actions?: ILinkDescriptor[];
	readonly ariaLabel?: string;
	readonly onClose?: () => void;
}

export const ITopBarService = createDecorator<ITopBarService>('topBarService');

export interface ITopBarService {

	readonly _serviceBrand: undefined;

	focus(): void;
}
