/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IModalDialogsService = createDecorator<IModalDialogsService>('modalDialogsService');

/**
 * A service that displays modal dialogs.
 */
export interface IModalDialogsService {

	readonly _serviceBrand: undefined;

	/**
	 * Shows example modal dialog 1.
	 */
	showExampleModalDialog1(title: string): Promise<void>;

	/**
	 * Shows example modal dialog 2.
	 */
	showExampleModalDialog2(title: string): Promise<boolean>;
}
