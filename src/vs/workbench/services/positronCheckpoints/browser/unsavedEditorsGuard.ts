/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IExtUri } from '../../../../base/common/resources.js';
import Severity from '../../../../base/common/severity.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
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

/**
 * The dirty working copies inside the project. Untitled working copies are ignored. Paths compare
 * with `extUri`, which treats letter case as the file system of each scheme does.
 */
function unsavedInProject(workingCopyService: IWorkingCopyService, extUri: IExtUri, projectRoot: URI): IWorkingCopy[] {
	return workingCopyService.dirtyWorkingCopies.filter(workingCopy =>
		!(workingCopy.capabilities & WorkingCopyCapabilities.Untitled)
		&& extUri.isEqualOrParent(workingCopy.resource, projectRoot));
}

/** The number of files in the project that have unsaved edits. Untitled files are not counted. */
export function countUnsavedInProject(workingCopyService: IWorkingCopyService, extUri: IExtUri, projectRoot: URI): number {
	return unsavedInProject(workingCopyService, extUri, projectRoot).length;
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
	const { extUri } = accessor.get(IUriIdentityService);

	const unsaved = unsavedInProject(workingCopyService, extUri, projectRoot);
	if (unsaved.length === 0) {
		return 'proceed';
	}

	// Runs after the dialog closes, so the list is read again: edits may have been saved or made
	// while the dialog was open.
	const saveAll = async (): Promise<UnsavedEditorsDecision> => {
		const toSave = unsavedInProject(workingCopyService, extUri, projectRoot);
		const saved = await Promise.all(toSave.map(workingCopy => workingCopy.save()));
		const failed = toSave.filter((_, index) => !saved[index]);
		if (failed.length > 0) {
			await dialogService.error(ServiceStrings.unsaved.saveFailed(extUri.basename(failed[0].resource), failed.length));
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
