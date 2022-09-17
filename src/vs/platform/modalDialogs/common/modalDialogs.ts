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
	 * Shows the time modal dialog.
	 */
	showTimeModalDialog(): Promise<void>;
}
