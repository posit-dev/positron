/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChangedFile } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';

/** The plain word for what happened to a file. */
export function statusWord(file: IChangedFile): string {
	switch (file.status) {
		case 'added':
			return Strings.changes.newFile();
		case 'deleted':
			return Strings.changes.deletedFile();
		case 'renamed':
			return Strings.changes.renamedFile();
		case 'modified':
			return Strings.changes.changedFile();
	}
}
