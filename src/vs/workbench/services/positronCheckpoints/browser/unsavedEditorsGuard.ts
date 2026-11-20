/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { extUri } from '../../../../base/common/resources.js';
import Severity from '../../../../base/common/severity.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceStrings } from '../common/checkpointsServiceStrings.js';
import { IWorkingCopy, WorkingCopyCapabilities } from '../../workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../workingCopy/common/workingCopyService.js';

/**
 * What the caller does next. `proceed` means every unsaved file was saved, or there were none.
 * `proceed-without-unsaved` leaves the unsaved edits out and is only offered in `checkpoint` mode.
 */
export type UnsavedEditorsDecision = 'proceed' | 'proceed-without-unsaved' | 'cancel';

/**
 * `checkpoint` is the creation of checkpoints, which can continue without the unsaved edits.
 * `file-changing` is any action that can rewrite files (Get changes, Go back, Undo, Redo), which
 * needs every unsaved edit saved first.
 */
export type UnsavedEditorsMode = 'checkpoint' | 'file-changing';

/** The dirty working copies inside the project. Untitled working copies are ignored. */
function unsavedInProject(workingCopyService: IWorkingCopyService, projectRoot: URI): IWorkingCopy[] {
	return workingCopyService.dirtyWorkingCopies.filter(workingCopy =>
		!(workingCopy.capabilities & WorkingCopyCapabilities.Untitled)
		&& extUri.isEqualOrParent(workingCopy.resource, projectRoot));
}

/** The number of files in the project that have unsaved edits. Untitled files are not counted. */
export function countUnsavedInProject(workingCopyService: IWorkingCopyService, projectRoot: URI): number {
	return unsavedInProject(workingCopyService, projectRoot).length;
}

/**
 * Asks what to do about files in the project with unsaved edits, and saves them when the person
 * chooses to. With no unsaved files it returns `proceed` without a dialog. When a save fails, no
 * action proceeds.
 */
export async function guardUnsavedEditors(
	accessor: ServicesAccessor,
	projectRoot: URI,
	mode: UnsavedEditorsMode
): Promise<UnsavedEditorsDecision> {
	const workingCopyService = accessor.get(IWorkingCopyService);
	const dialogService = accessor.get(IDialogService);

	const unsaved = unsavedInProject(workingCopyService, projectRoot);
	if (unsaved.length === 0) {
		return 'proceed';
	}

	const saveAll = async (): Promise<UnsavedEditorsDecision> => {
		const saved = await Promise.all(unsaved.map(workingCopy => workingCopy.save()));
		const failures = saved.filter(ok => !ok).length;
		if (failures > 0) {
			await dialogService.error(ServiceStrings.unsaved.saveFailed(failures));
			return 'cancel';
		}
		return 'proceed';
	};

	const cancelButton = { label: ServiceStrings.unsaved.cancel(), run: (): UnsavedEditorsDecision => 'cancel' };

	if (mode === 'checkpoint') {
		const { result } = await dialogService.prompt<UnsavedEditorsDecision>({
			type: Severity.Warning,
			message: ServiceStrings.unsaved.checkpointMessage(unsaved.length),
			detail: ServiceStrings.unsaved.checkpointDetail(),
			buttons: [
				{ label: ServiceStrings.unsaved.saveAndInclude(unsaved.length), run: saveAll },
				{ label: ServiceStrings.unsaved.continueWithout(), run: () => 'proceed-without-unsaved' },
			],
			cancelButton,
		});
		return result;
	}

	const { result } = await dialogService.prompt<UnsavedEditorsDecision>({
		type: Severity.Warning,
		message: ServiceStrings.unsaved.fileChangingMessage(unsaved.length),
		detail: ServiceStrings.unsaved.fileChangingDetail(),
		buttons: [
			{ label: ServiceStrings.unsaved.saveAllAndContinue(), run: saveAll },
		],
		cancelButton,
	});
	return result;
}
