/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, isAbsolute } from 'path';
import { QuickInput } from '../quickinput';
import { QuickAccess } from '../quickaccess';


export class PositronQuickAccess {

	constructor(private quickInput: QuickInput,
		private quickAccess: QuickAccess) { }


	async openDataFile(path: string): Promise<void> {
		if (!isAbsolute(path)) {
			// we require absolute paths to get a single
			// result back that is unique and avoid hitting
			// the search process to reduce chances of
			// search needing longer.
			throw new Error('QuickAccess.openFile requires an absolute path');
		}

		// quick access shows files with the basename of the path
		await this.quickAccess.openFileQuickAccessAndWait(path, basename(path));

		// open first element
		await this.quickInput.selectQuickInputElement(0);
	}
}
