/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICheckpoint } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from './checkpointsStrings.js';
import { FORBIDDEN_WORDS } from './forbiddenWords.js';

/**
 * The title of a checkpoint as the main view shows it. A title with a git word, such as a
 * colleague's "Merge pull request #12 from x/branch", is replaced by a neutral sentence that names
 * the author: "Combined work from Maya" when the title begins with "Merge", and "Work from Maya"
 * otherwise. The original title stays visible under "Show git details".
 */
export function displayTitle(checkpoint: Pick<ICheckpoint, 'title' | 'authorName'>): string {
	if (!FORBIDDEN_WORDS.test(checkpoint.title)) {
		return checkpoint.title;
	}
	return /^\s*merg(e|ed|ing)\b/i.test(checkpoint.title)
		? Strings.history.combinedWorkFrom(checkpoint.authorName)
		: Strings.history.workFrom(checkpoint.authorName);
}
