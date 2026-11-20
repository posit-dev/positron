/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

// The user-facing strings of the services layer. The view layer re-exports these through
// `Strings` in `contrib/positronCheckpoints/common/checkpointsStrings.ts`, which also applies the
// vocabulary check to them. The same vocabulary rules hold: no branch, commit, stage, rebase,
// merge, pull, push, fetch, HEAD, or conflict.

/** One string for a count of one and another for any other count. */
function plural(count: number, one: string, other: string): string {
	return count === 1 ? one : other;
}

const unsaved = {
	cancel: () => localize('positron.checkpoints.unsaved.cancel', "Cancel"),
	saveAndInclude: (count: number) => plural(count,
		localize('positron.checkpoints.unsaved.saveAndInclude.one', "Save 1 file and include it"),
		localize('positron.checkpoints.unsaved.saveAndInclude.other', "Save {0} files and include them", count)),
	continueWithout: () => localize('positron.checkpoints.unsaved.continueWithout', "Continue without the unsaved edits"),
	saveAllAndContinue: () => localize('positron.checkpoints.unsaved.saveAllAndContinue', "Save all and continue"),
	checkpointMessage: (count: number) => plural(count,
		localize('positron.checkpoints.unsaved.checkpointMessage.one', "1 file in this project has unsaved edits."),
		localize('positron.checkpoints.unsaved.checkpointMessage.other', "{0} files in this project have unsaved edits.", count)),
	checkpointDetail: () => localize('positron.checkpoints.unsaved.checkpointDetail', "A checkpoint records the files as they are saved on disk."),
	fileChangingMessage: (count: number) => plural(count,
		localize('positron.checkpoints.unsaved.fileChangingMessage.one', "1 file in this project has unsaved edits."),
		localize('positron.checkpoints.unsaved.fileChangingMessage.other', "{0} files in this project have unsaved edits.", count)),
	fileChangingDetail: () => localize('positron.checkpoints.unsaved.fileChangingDetail', "This action can rewrite files, so unsaved edits must be saved first."),
	saveFailed: (count: number) => plural(count,
		localize('positron.checkpoints.unsaved.saveFailed.one', "1 file could not be saved. Nothing was changed."),
		localize('positron.checkpoints.unsaved.saveFailed.other', "{0} files could not be saved. Nothing was changed.", count)),
};

export const ServiceStrings = {
	unsaved,
};
