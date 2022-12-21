/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * Export the service identifier.
 */
export const IPositronModalDialogsService = createDecorator<IPositronModalDialogsService>('positronModalDialogsService');

/**
 * A service that displays modal dialogs.
 */
export interface IPositronModalDialogsService {

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
