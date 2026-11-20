/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { plural, ServiceStrings } from '../../../services/positronCheckpoints/common/checkpointsServiceStrings.js';
import { OperationResult, UnavailableReason, RejectedReason, UnusualKind } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';

// Every user-facing string of the Checkpoints view is defined here, so the vocabulary changes in
// one place. The main view never shows the words branch, commit, stage, rebase, merge, pull, push,
// fetch, HEAD, or conflict; an overlap is the word for a conflict. Only `Strings.gitDetails`, the
// labels of the "Show git details" area, may name git objects.
//
// Each group below is a plain object of functions, so a test can walk the groups and call every
// function.

/** Joins sentences into one string, giving each exactly one closing period. */
function joinSentences(sentences: string[]): string {
	return sentences.map(sentence => sentence.replace(/\.$/, '')).join('. ') + '.';
}

const status = {
	noEngine: () => localize('positron.checkpoints.status.noEngine', "Checkpoints are not available yet."),
	couldNotRead: () => localize('positron.checkpoints.status.couldNotRead', "The state of this project could not be read."),
	interrupted: (description: string) => localize('positron.checkpoints.status.interrupted', "The action \"{0}\" was interrupted before it finished.", description),
	syncUnavailable: (version: string) => localize('positron.checkpoints.status.syncUnavailable', "Getting and sending changes needs git version {0} or newer.", version),
	behind: (count: number) => plural(count,
		localize('positron.checkpoints.status.behind.one', "Colleagues added 1 checkpoint to the shared copy."),
		localize('positron.checkpoints.status.behind.other', "Colleagues added {0} checkpoints to the shared copy.", count)),
	partOfProject: (projectName: string) => localize('positron.checkpoints.status.partOfProject', "This folder is part of the project {0}", projectName),
	onlyOnThisComputer: () => localize('positron.checkpoints.status.onlyOnThisComputer', "This project is only on this computer"),
	notKeepingCheckpoints: () => localize('positron.checkpoints.status.notKeepingCheckpoints', "This folder is not keeping checkpoints yet."),
	identityMissing: () => localize('positron.checkpoints.status.identityMissing', "Checkpoints need your name and email address, so that colleagues can see who made them."),
	upToDate: () => localize('positron.checkpoints.status.upToDate', "You have everything in the shared copy."),
	waitingToSend: (count: number) => plural(count,
		localize('positron.checkpoints.status.waitingToSend.one', "1 checkpoint is not yet in the shared copy."),
		localize('positron.checkpoints.status.waitingToSend.other', "{0} checkpoints are not yet in the shared copy.", count)),
	incoming: (author: string, count: number) => plural(count,
		localize('positron.checkpoints.status.incoming.one', "{0} added 1 checkpoint to the shared copy.", author),
		localize('positron.checkpoints.status.incoming.other', "{0} added {1} checkpoints to the shared copy.", author, count)),
	incomingWithoutAuthor: (count: number) => plural(count,
		localize('positron.checkpoints.status.incomingNoAuthor.one', "1 new checkpoint is in the shared copy."),
		localize('positron.checkpoints.status.incomingNoAuthor.other', "{0} new checkpoints are in the shared copy.", count)),
	incomingTouchesWork: () => localize('positron.checkpoints.status.incomingTouchesWork', "Some of these changes are in files you also changed."),
	incomingSeparate: () => localize('positron.checkpoints.status.incomingSeparate', "These changes do not touch your work."),
	lastChecked: (when: string) => localize('positron.checkpoints.status.lastChecked', "Last checked {0}.", when),
	recoveryNotice: (kind: 'reversed' | 'completed') => kind === 'reversed'
		? localize('positron.checkpoints.status.recoveryReversed', "An action was interrupted when Positron closed. It has been reversed.")
		: localize('positron.checkpoints.status.recoveryCompleted', "An action was interrupted when Positron closed. It has been completed."),
	recoverySnapshot: () => localize('positron.checkpoints.status.recoverySnapshot', "Project as it was before recovery"),
	pendingApproval: () => localize('positron.checkpoints.status.pendingApproval', "A check set up for this project also changed these files."),
	pendingOverlap: () => localize('positron.checkpoints.status.pendingOverlap', "Some of your changes overlap with changes from the shared copy. Nothing has changed in your project yet."),
	/** One plain sentence for each unusual state. The Source Control view link follows it. */
	unusual: (kind: UnusualKind): string => {
		switch (kind) {
			case 'detached':
				return localize('positron.checkpoints.status.unusual.detached', "Another git tool left this project looking at an old version instead of the latest one.");
			case 'operation-in-progress':
				return localize('positron.checkpoints.status.unusual.operationInProgress', "Another git tool left this project in the middle of an operation");
			case 'staged-differs':
				return localize('positron.checkpoints.status.unusual.stagedDiffers', "Another git tool prepared part of a file for its own use, and it no longer matches the file you see.");
			case 'unrecovered':
				return localize('positron.checkpoints.status.unusual.unrecovered', "An action was interrupted and this view could not finish it. Your work is saved, and a person who knows git can restore it.");
			case 'git-missing':
				return localize('positron.checkpoints.status.unusual.gitMissing', "Checkpoints need the git program, and it was not found on this computer.");
		}
	},
	unusualHelp: () => localize('positron.checkpoints.status.unusualHelp', "Open the Source Control view to look at this project."),
	needsGitTool: () => localize('positron.checkpoints.status.needsGitTool', "This needs a git tool"),
};

const actions = {
	createCheckpoint: () => localize('positron.checkpoints.actions.createCheckpoint', "Create checkpoint..."),
	createCheckpoints: (count: number) => plural(count,
		localize('positron.checkpoints.actions.createCheckpoints.one', "Create 1 checkpoint"),
		localize('positron.checkpoints.actions.createCheckpoints.other', "Create {0} checkpoints", count)),
	getChanges: () => localize('positron.checkpoints.actions.getChanges', "Get Changes"),
	getAuthorsChanges: (author: string) => localize('positron.checkpoints.actions.getAuthorsChanges', "Get {0}'s changes", author),
	sendChanges: () => localize('positron.checkpoints.actions.sendChanges', "Send Changes"),
	checkSharedCopy: () => localize('positron.checkpoints.actions.checkSharedCopy', "Check the Shared Copy"),
	goBack: () => localize('positron.checkpoints.actions.goBack', "Go Back to This Checkpoint"),
	reverseCheckpoint: () => localize('positron.checkpoints.actions.reverseCheckpoint', "Reverse This Checkpoint"),
	editDescription: () => localize('positron.checkpoints.actions.editDescription', "Edit Description"),
	startKeepingCheckpoints: () => localize('positron.checkpoints.actions.startKeepingCheckpoints', "Start keeping checkpoints"),
	viewDetailedDifferences: () => localize('positron.checkpoints.actions.viewDetailedDifferences', "View detailed differences"),
	/** The accessible name of a "View detailed differences" action of one file. */
	viewDetailedDifferencesOf: (path: string) => localize('positron.checkpoints.actions.viewDetailedDifferencesOf', "View detailed differences: {0}", path),
	showGitDetails: () => localize('positron.checkpoints.actions.showGitDetails', "Show git details"),
	edit: () => localize('positron.checkpoints.actions.edit', "Edit"),
	dismiss: () => localize('positron.checkpoints.actions.dismiss', "Dismiss"),
	accept: () => localize('positron.checkpoints.actions.accept', "Accept"),
	chooseMyself: () => localize('positron.checkpoints.actions.chooseMyself', "Choose myself"),
	backOut: () => localize('positron.checkpoints.actions.backOut', "Back out"),
	cancel: () => localize('positron.checkpoints.actions.cancel', "Cancel"),
	undo: (description: string) => localize('positron.checkpoints.actions.undo', "Undo: {0}", description),
	redo: (description: string) => localize('positron.checkpoints.actions.redo', "Redo: {0}", description),
	undoLastAction: () => localize('positron.checkpoints.actions.undoLastAction', "Undo last action"),
	undoProjectCheckChanges: () => localize('positron.checkpoints.actions.undoProjectCheckChanges', "Undo: changes made by the project check"),
	undoHover: (operations: number, days: number) => localize('positron.checkpoints.actions.undoHover', "Undo covers your last {0} actions from the last {1} days.", operations, days),
	acceptCheckedCheckpoint: () => localize('positron.checkpoints.actions.acceptCheckedCheckpoint', "Create the checkpoint with these changes"),
	declineCheckedCheckpoint: () => localize('positron.checkpoints.actions.declineCheckedCheckpoint', "Do not create the checkpoint"),
	reverseKeepNewer: () => localize('positron.checkpoints.actions.reverseKeepNewer', "Reverse the action and keep my newer files"),
	leaveAsIs: () => localize('positron.checkpoints.actions.leaveAsIs', "Leave the project as it is"),
	removeRecoverySnapshot: () => localize('positron.checkpoints.actions.removeRecoverySnapshot', "Remove"),
	openSourceControl: () => localize('positron.checkpoints.actions.openSourceControl', "Open Source Control"),
	close: () => localize('positron.checkpoints.actions.close', "Close"),
	reviewCheckChanges: () => localize('positron.checkpoints.actions.reviewCheckChanges', "Review the changes"),
	removeRecoverySnapshotAt: (when: string) => localize('positron.checkpoints.actions.removeRecoverySnapshotAt', "Remove: Project as it was before recovery ({0})", when),
	useTheirsKeepCopy: () => localize('positron.checkpoints.actions.useTheirsKeepCopy', "Use theirs and keep a copy of mine"),
};

const changes = {
	heading: () => localize('positron.checkpoints.changes.heading', "Changes since your last checkpoint"),
	none: () => localize('positron.checkpoints.changes.none', "No changes since your last checkpoint."),
	unsavedNote: (count: number) => plural(count,
		localize('positron.checkpoints.changes.unsavedNote.one', "1 file has unsaved edits that are not shown"),
		localize('positron.checkpoints.changes.unsavedNote.other', "{0} files have unsaved edits that are not shown", count)),
	fileCount: (count: number) => plural(count,
		localize('positron.checkpoints.changes.fileCount.one', "1 file"),
		localize('positron.checkpoints.changes.fileCount.other', "{0} files", count)),
	newFile: () => localize('positron.checkpoints.changes.newFile', "new"),
	deletedFile: () => localize('positron.checkpoints.changes.deletedFile', "removed"),
	renamedFile: () => localize('positron.checkpoints.changes.renamedFile', "renamed"),
	previousName: (oldPath: string) => localize('positron.checkpoints.changes.previousName', "was {0}", oldPath),
	changedFile: () => localize('positron.checkpoints.changes.changedFile', "changed"),
	binaryFile: (size: string) => localize('positron.checkpoints.changes.binaryFile', "data file, {0}", size),
	tooLarge: (path: string, limitMegabytes: number) => localize('positron.checkpoints.changes.tooLarge', "{0} is over {1} MB. It is left out of the checkpoint unless you include it.", path, limitMegabytes),
	titleTooLong: (limit: number) => localize('positron.checkpoints.changes.titleTooLong', "The title can have up to {0} characters.", limit),
	chunkTitle: (index: number) => localize('positron.checkpoints.changes.chunkTitle', "Checkpoint {0}", index),
	dialogTitle: () => localize('positron.checkpoints.changes.dialogTitle', "Create Checkpoints"),
	titleLabel: () => localize('positron.checkpoints.changes.titleLabel', "Title"),
	bodyLabel: () => localize('positron.checkpoints.changes.bodyLabel', "Description (optional)"),
	addAnotherCheckpoint: () => localize('positron.checkpoints.changes.addAnotherCheckpoint', "Add another checkpoint"),
	moveFileTo: (path: string) => localize('positron.checkpoints.changes.moveFileTo', "Move {0} to", path),
	noFilesInChunk: () => localize('positron.checkpoints.changes.noFilesInChunk', "No files yet. Move a file here to put it in this checkpoint."),
	savedAndAdded: (count: number) => plural(count,
		localize('positron.checkpoints.changes.savedAndAdded.one', "This file was saved and added. Review it, then create the checkpoint again."),
		localize('positron.checkpoints.changes.savedAndAdded.other', "These files were saved and added. Review them, then create the checkpoint again.")),
	savedAndAddedTag: () => localize('positron.checkpoints.changes.savedAndAddedTag', "saved and added"),
	savedContentChanged: () => localize('positron.checkpoints.changes.savedContentChanged', "These files were saved. Review and confirm."),
	savedAndChanged: () => localize('positron.checkpoints.changes.savedAndChanged', "Saving changed the list of files. Review the checkpoints, then create them again."),
};

const diff = {
	changeTitle: (path: string) => localize('positron.checkpoints.diff.changeTitle', "{0} (changes since your last checkpoint)", path),
	sizes: (before: string | undefined, after: string | undefined): string => {
		if (before !== undefined && after !== undefined) {
			return localize('positron.checkpoints.diff.sizesBoth', "Before: {0}. Now: {1}.", before, after);
		}
		return before !== undefined
			? localize('positron.checkpoints.diff.sizesBefore', "Before: {0}.", before)
			: localize('positron.checkpoints.diff.sizesAfter', "Now: {0}.", after ?? '');
	},
	binaryMessage: (path: string, sizes: string) => localize('positron.checkpoints.diff.binaryMessage', "{0} is a data file, so there is no line-by-line comparison. {1}", path, sizes),
	tooLargeMessage: (path: string, limitMegabytes: number, sizes: string) => localize('positron.checkpoints.diff.tooLargeMessage', "{0} is over {1} MB, so there is no line-by-line comparison. {2}", path, limitMegabytes, sizes),
	unavailable: (path: string) => localize('positron.checkpoints.diff.unavailable', "The differences for {0} could not be read.", path),
	pendingTitle: (path: string) => localize('positron.checkpoints.diff.pendingTitle', "{0} (as the check changed it)", path),
};

const history = {
	heading: () => localize('positron.checkpoints.history.heading', "History"),
	empty: () => localize('positron.checkpoints.history.empty', "No checkpoints yet. Create the first one when your work is in a good place."),
	you: () => localize('positron.checkpoints.history.you', "You"),
	notYetShared: () => localize('positron.checkpoints.history.notYetShared', "not yet shared"),
	partialFiles: (files: string[]) => localize('positron.checkpoints.history.partialFiles', "Contains part of the changes to {0}", files.join(', ')),
	returnedTo: (label: string) => localize('positron.checkpoints.history.returnedTo', "Returned to {0}", label),
	loadMore: () => localize('positron.checkpoints.history.loadMore', "Show older checkpoints"),
	showDetails: (title: string) => localize('positron.checkpoints.history.showDetails', "Show details of {0}", title),
	editDialogTitle: () => localize('positron.checkpoints.history.editDialogTitle', "Edit Description"),
	editSave: () => localize('positron.checkpoints.history.editSave', "Save"),
	reverseDialogTitle: () => localize('positron.checkpoints.history.reverseDialogTitle', "Reverse This Checkpoint"),
	reverseExplain: (title: string) => localize('positron.checkpoints.history.reverseExplain', "Reversing \"{0}\" creates a new checkpoint that makes the opposite change. The original checkpoint stays in the history.", title),
	reverseConfirm: () => localize('positron.checkpoints.history.reverseConfirm', "Reverse"),
};

const resultSentences = {
	checkFailed: () => localize('positron.checkpoints.results.checkFailed', "A check set up for this project did not pass"),
	checkChangedCheckpoint: () => localize('positron.checkpoints.results.checkChangedCheckpoint', "A check set up for this project also changed these files"),
	checkChangedFilesOnDisk: (count: number) => plural(count,
		localize('positron.checkpoints.results.checkChangedFilesOnDisk.one', "The check also changed 1 file on disk"),
		localize('positron.checkpoints.results.checkChangedFilesOnDisk.other', "The check also changed {0} files on disk", count)),
	createAgain: () => localize('positron.checkpoints.results.createAgain', "Create the checkpoint again to include these changes."),
	couldNotFinish: () => localize('positron.checkpoints.results.couldNotFinish', "That action could not finish. Your project is as it was."),
	interrupted: () => localize('positron.checkpoints.results.interrupted', "That action was interrupted, and some files were changed while it ran. Choose what to do next."),
	interruptedBy: (description: string, fileCount: number) => plural(fileCount,
		localize('positron.checkpoints.results.interruptedBy.one', "{0} was interrupted, and 1 file was changed afterwards.", description),
		localize('positron.checkpoints.results.interruptedBy.other', "{0} was interrupted, and {1} files were changed afterwards.", description, fileCount)),
	changesMoved: () => localize('positron.checkpoints.results.changesMoved', "Your files changed while the checkpoints were being prepared. Nothing was created. Review the changes and try again."),
	projectChanged: () => localize('positron.checkpoints.results.projectChanged', "Another tool changed this project after that action. Nothing was changed."),
	overlaps: (count: number) => plural(count,
		localize('positron.checkpoints.results.overlaps.one', "1 change overlaps with your work. Choose how to combine them. Nothing has changed in your project yet."),
		localize('positron.checkpoints.results.overlaps.other', "{0} changes overlap with your work. Choose how to combine them. Nothing has changed in your project yet.", count)),
	pathCollisions: () => localize('positron.checkpoints.results.pathCollisions', "Some files on this computer are in no checkpoint, and this action would replace them. Nothing has changed yet. Choose what to do with each file."),
	inputsChangedShared: (author: string) => localize('positron.checkpoints.results.inputsChangedShared', "{0} added more changes since you reviewed this", author),
	inputsChangedSharedUnknown: () => localize('positron.checkpoints.results.inputsChangedSharedUnknown', "More changes were added to the shared copy since you reviewed this"),
	inputsChangedFiles: () => localize('positron.checkpoints.results.inputsChangedFiles', "One of the overlapping files changed since you reviewed this."),
	inputsChangedMine: () => localize('positron.checkpoints.results.inputsChangedMine', "You created a checkpoint since you reviewed this"),
	reviewAgain: () => localize('positron.checkpoints.results.reviewAgain', "The changes are shown again. Nothing was changed."),
	rejected: (reason: RejectedReason): string => {
		switch (reason) {
			case 'shared-copy-moved':
				return localize('positron.checkpoints.results.rejected.sharedCopyMoved', "Someone added changes to the shared copy first. Get their changes, then send yours.");
			case 'review-required':
				return localize('positron.checkpoints.results.rejected.reviewRequired', "The shared copy needs a colleague to review changes before they join it.");
			case 'sign-in-required':
				return localize('positron.checkpoints.results.rejected.signInRequired', "Sign in to the service that hosts the shared copy, then try again.");
			case 'no-shared-copy':
				return localize('positron.checkpoints.results.rejected.noSharedCopy', "This project is only on this computer, so there is no shared copy.");
			case 'offline':
				return localize('positron.checkpoints.results.rejected.offline', "The shared copy could not be reached. Check your connection and try again.");
			case 'unknown':
				return localize('positron.checkpoints.results.rejected.unknown', "The shared copy did not accept the request.");
		}
	},
	unavailable: (reason: UnavailableReason): string => {
		switch (reason) {
			case 'busy':
				return localize('positron.checkpoints.results.unavailable.busy', "Another window is working on this project.");
			case 'unusual-state':
				return localize('positron.checkpoints.results.unavailable.unusualState', "This project is in a state Checkpoints cannot work with. See the message at the top of the view.");
			case 'git-too-old':
				return localize('positron.checkpoints.results.unavailable.gitTooOld', "Getting and sending changes needs git version 2.40 or newer. Update git to use them.");
			case 'not-tracking':
				return localize('positron.checkpoints.results.unavailable.notTracking', "This folder is not keeping checkpoints yet.");
			case 'stale-operation-id':
				return localize('positron.checkpoints.results.unavailable.staleOperationId', "That is no longer the latest action. The view has been refreshed.");
			case 'not-undoable':
				return localize('positron.checkpoints.results.unavailable.notUndoable', "That action cannot be undone.");
			case 'shared-checkpoint':
				return localize('positron.checkpoints.results.unavailable.sharedCheckpoint', "This checkpoint is already in the shared copy, so it cannot be undone. Use Reverse This Checkpoint to make a new checkpoint with the opposite change.");
			case 'timed-out':
				return localize('positron.checkpoints.results.unavailable.timedOut', "The project did not respond in time. No files were changed. Try again.");
			case 'nothing-to-do':
				return localize('positron.checkpoints.results.unavailable.nothingToDo', "There were no changes to act on, so no files were changed.");
			case 'occupied':
				return localize('positron.checkpoints.results.unavailable.occupied', "A file is already in that place. Choose a new name or place for the kept file.");
		}
	},
};

/**
 * The sentence for a result, or undefined when the result needs no message (a plain success that
 * changed no file on disk).
 */
function forOperation(result: OperationResult): string | undefined {
	switch (result.kind) {
		case 'done':
			return result.hookEditedFiles.length > 0 ? joinSentences([resultSentences.checkChangedFilesOnDisk(result.hookEditedFiles.length)]) : undefined;
		case 'check-failed': {
			const sentences = [resultSentences.checkFailed()];
			if (result.hookEditedFiles.length > 0) {
				sentences.push(resultSentences.checkChangedFilesOnDisk(result.hookEditedFiles.length), resultSentences.createAgain());
			}
			return joinSentences(sentences);
		}
		case 'check-changed-checkpoint':
			return joinSentences([resultSentences.checkChangedCheckpoint()]);
		case 'path-collisions':
			return resultSentences.pathCollisions();
		case 'overlaps':
			return resultSentences.overlaps(result.preview.overlaps.length);
		case 'inputs-changed': {
			const sentences: string[] = [];
			const incoming = result.preview.incoming;
			const author = incoming.length > 0 ? incoming[incoming.length - 1].authorName : undefined;
			for (const changed of result.changed) {
				if (changed === 'shared') {
					sentences.push(author ? resultSentences.inputsChangedShared(author) : resultSentences.inputsChangedSharedUnknown());
				} else if (changed === 'files') {
					sentences.push(resultSentences.inputsChangedFiles());
				} else {
					sentences.push(resultSentences.inputsChangedMine());
				}
			}
			sentences.push(resultSentences.reviewAgain());
			return joinSentences(sentences);
		}
		case 'changes-moved':
			return resultSentences.changesMoved();
		case 'project-changed':
			return resultSentences.projectChanged();
		case 'rejected':
			return resultSentences.rejected(result.reason);
		case 'could-not-finish':
			return resultSentences.couldNotFinish();
		case 'interrupted':
			return resultSentences.interrupted();
		case 'unavailable':
			return resultSentences.unavailable(result.reason);
	}
}

const results = { ...resultSentences, forOperation };

const undoRedo = {
	filesChangedSince: (count: number) => plural(count,
		localize('positron.checkpoints.undoRedo.filesChangedSince.one', "You changed 1 file since then. Undo will set it back, and Redo will return it."),
		localize('positron.checkpoints.undoRedo.filesChangedSince.other', "You changed {0} files since then. Undo will set them back, and Redo will return them.", count)),
	expired: () => localize('positron.checkpoints.undoRedo.expired', "This action is too old to undo."),
};

const collisions = {
	explainWithAuthor: (author: string, path: string) => localize('positron.checkpoints.collisions.explainWithAuthor', "{0} added a file named {1}. You have your own {1} that is in no checkpoint.", author, path),
	explainIgnored: (path: string) => localize('positron.checkpoints.collisions.explainIgnored', "This action would replace your file {0}, which is in no checkpoint.", path),
	explainTooLarge: (path: string, size: string) => localize('positron.checkpoints.collisions.explainTooLarge', "This action would replace your file {0} ({1}), which is too large to keep in a checkpoint.", path, size),
	keepCopyHelp: (path: string) => localize('positron.checkpoints.collisions.keepCopyHelp', "A copy of your {0} is kept aside, and you can restore it later.", path),
	dialogTitle: () => localize('positron.checkpoints.collisions.dialogTitle', "Files in No Checkpoint"),
	continue: () => localize('positron.checkpoints.collisions.continue', "Continue"),
	cancelled: () => localize('positron.checkpoints.collisions.cancelled', "Nothing was changed."),
};

const sync = {
	done: () => localize('positron.checkpoints.sync.done', "The changes from the shared copy are now in your project."),
	changedFiles: () => localize('positron.checkpoints.sync.changedFiles', "Files these changes touch"),
	diffTitle: (path: string) => localize('positron.checkpoints.sync.diffTitle', "{0} (changes from the shared copy)", path),
};

const overlaps = {
	heading: () => localize('positron.checkpoints.overlaps.heading', "Overlapping changes"),
	title: (path: string) => localize('positron.checkpoints.overlaps.title', "Overlap in {0}", path),
	keepMine: () => localize('positron.checkpoints.overlaps.keepMine', "Keep mine"),
	keepTheirs: (author: string) => localize('positron.checkpoints.overlaps.keepTheirs', "Keep {0}'s", author),
	keepBoth: () => localize('positron.checkpoints.overlaps.keepBoth', "Keep both"),
	keepEditedFile: () => localize('positron.checkpoints.overlaps.keepEditedFile', "Keep the edited file"),
	acceptDeletion: () => localize('positron.checkpoints.overlaps.acceptDeletion', "Accept the deletion"),
	newNameFor: (path: string) => localize('positron.checkpoints.overlaps.newNameFor', "New name for {0}", path),
	textExplain: (author: string, path: string) => localize('positron.checkpoints.overlaps.textExplain', "You and {0} both changed the same lines of {1}.", author, path),
	binaryExplain: (author: string, path: string) => localize('positron.checkpoints.overlaps.binaryExplain', "You and {0} both changed {1}, which is a data file. Choose one version, or keep both under different names.", author, path),
	editDeleteExplain: (author: string, path: string, deletedBy: 'me' | 'them') => deletedBy === 'them'
		? localize('positron.checkpoints.overlaps.editDeleteThem', "You edited {1}, and {0} deleted it.", author, path)
		: localize('positron.checkpoints.overlaps.editDeleteMe', "You deleted {1}, and {0} edited it.", author, path),
	renameExplain: (author: string, path: string) => localize('positron.checkpoints.overlaps.renameExplain', "You and {0} renamed {1} in different ways. Choose the name to keep.", author, path),
	/** `fileSide` names who has the file; the other person has the folder. */
	fileFolderExplain: (author: string, path: string, fileSide: 'me' | 'them') => fileSide === 'me'
		? localize('positron.checkpoints.overlaps.fileFolderExplain', "You have a file named {1} where {0} has a folder. Keep both under different names, or choose one.", author, path)
		: localize('positron.checkpoints.overlaps.fileFolderExplainTheirs', "{0} has a file named {1} where you have a folder. Keep both under different names, or choose one.", author, path),
	unsupportedExplain: (path: string) => localize('positron.checkpoints.overlaps.unsupportedExplain', "{0} has a change this view cannot combine.", path),
	editorTitle: (path: string) => localize('positron.checkpoints.overlaps.editorTitle', "Overlap: {0}", path),
	combinedText: () => localize('positron.checkpoints.overlaps.combinedText', "Combined text"),
	mineLabel: () => localize('positron.checkpoints.overlaps.mineLabel', "Mine"),
	theirsLabel: (author: string) => localize('positron.checkpoints.overlaps.theirsLabel', "{0}'s", author),
	baseLabel: () => localize('positron.checkpoints.overlaps.baseLabel', "Before either change"),
	applyChoices: () => localize('positron.checkpoints.overlaps.applyChoices', "Apply Choices"),
	keepName: (path: string) => localize('positron.checkpoints.overlaps.keepName', "Keep the name {0}", path),
	sizes: (mine: string, author: string, theirs: string) => localize('positron.checkpoints.overlaps.sizes', "Yours: {0}. {1}'s: {2}.", mine, author, theirs),
	mineNameLabel: () => localize('positron.checkpoints.overlaps.mineNameLabel', "mine"),
	copyNameLabel: () => localize('positron.checkpoints.overlaps.copyNameLabel', "copy"),
	combinedTextEmpty: () => localize('positron.checkpoints.overlaps.combinedTextEmpty', "The combined text is empty. Neither version was empty, so choose one of the options above or type the text to keep."),
	newNameInvalid: (path: string) => localize('positron.checkpoints.overlaps.newNameInvalid', "Choose a new name that differs from {0}.", path),
	choicesFor: (path: string) => localize('positron.checkpoints.overlaps.choicesFor', "Choices for {0}", path),
	chooseEach: () => localize('positron.checkpoints.overlaps.chooseEach', "Choose what to keep for every overlap, then apply your choices. Nothing changes in your project until then."),
	none: () => localize('positron.checkpoints.overlaps.none', "There are no overlaps to choose for."),
	editorLabel: () => localize('positron.checkpoints.overlaps.editorLabel', "Overlap Editor"),
};

const start = {
	dialogTitle: () => localize('positron.checkpoints.start.dialogTitle', "Start Keeping Checkpoints"),
	intro: () => localize('positron.checkpoints.start.intro', "Checkpoints will keep a record of the files in this folder, starting with a first checkpoint of everything that is here now."),
	startButton: () => localize('positron.checkpoints.start.startButton', "Start"),
	identityWhy: () => localize('positron.checkpoints.start.identityWhy', "Checkpoints records who made each one."),
	nameLabel: () => localize('positron.checkpoints.start.nameLabel', "Your name"),
	emailLabel: () => localize('positron.checkpoints.start.emailLabel', "Your email address"),
	emailInvalid: () => localize('positron.checkpoints.start.emailInvalid', "Enter an email address that contains @."),
	leaveOut: () => localize('positron.checkpoints.start.leaveOut', "Leave these files out of checkpoints"),
	leaveOutBox: () => localize('positron.checkpoints.start.leaveOutBox', "Files and folders to leave out, one per line"),
	leaveOutHelp: () => localize('positron.checkpoints.start.leaveOutHelp', "These are files that data science projects usually do not keep, such as saved history and temporary files. You can change the list."),
	couldNotLoad: () => localize('positron.checkpoints.start.couldNotLoad', "The list of files to leave out could not be read."),
	tryAgain: () => localize('positron.checkpoints.start.tryAgain', "Try Again"),
	identityNotRecorded: () => localize('positron.checkpoints.start.identityNotRecorded', "Checkpoints could not record your name and email. Try again."),
};

const kept = {
	heading: () => localize('positron.checkpoints.kept.heading', "Files kept aside"),
	totalSize: (size: string) => localize('positron.checkpoints.kept.totalSize', "{0} in total. These files are in no checkpoint.", size),
	restore: () => localize('positron.checkpoints.kept.restore', "Restore"),
	/** A kept file is moved, not copied, so the label says so. */
	moveToAnotherPlace: () => localize('positron.checkpoints.kept.moveToAnotherPlace', "Move to another place..."),
	delete: () => localize('positron.checkpoints.kept.delete', "Delete"),
	restoreOf: (path: string) => localize('positron.checkpoints.kept.restoreOf', "Restore: {0}", path),
	moveOf: (path: string) => localize('positron.checkpoints.kept.moveOf', "Move to another place: {0}", path),
	deleteOf: (path: string) => localize('positron.checkpoints.kept.deleteOf', "Delete: {0}", path),
	deleteConfirm: (path: string) => localize('positron.checkpoints.kept.deleteConfirm', "Delete {0}?", path),
	deleteDetail: () => localize('positron.checkpoints.kept.deleteDetail', "This file is in no checkpoint. After you delete it, it cannot be recovered."),
	keptBy: (action: string) => localize('positron.checkpoints.kept.keptBy', "Kept aside by: {0}", action),
	chooseNewPlace: (path: string) => localize('positron.checkpoints.kept.chooseNewPlace', "Choose a place for {0}", path),
	moveHere: () => localize('positron.checkpoints.kept.moveHere', "Move Here"),
	outsideProject: () => localize('positron.checkpoints.kept.outsideProject', "Choose a place inside this project. The file stays aside."),
	couldNotLoad: () => localize('positron.checkpoints.kept.couldNotLoad', "The list of files kept aside could not be read."),
	tryAgain: () => localize('positron.checkpoints.kept.tryAgain', "Try Again"),
};

const interrupted = {
	heading: () => localize('positron.checkpoints.interrupted.heading', "An action was interrupted"),
	changedFiles: () => localize('positron.checkpoints.interrupted.changedFiles', "These files were changed afterwards:"),
	stagedWork: () => localize('positron.checkpoints.interrupted.stagedWork', "Work set aside by another git tool was also changed."),
	dialogTitle: () => localize('positron.checkpoints.interrupted.dialogTitle', "Interrupted Action"),
	reviewButton: () => localize('positron.checkpoints.interrupted.reviewButton', "Choose what to do"),
	reverseHelp: () => localize('positron.checkpoints.interrupted.reverseHelp', "The action is reversed. The files listed above stay as they are."),
	leaveHelp: () => localize('positron.checkpoints.interrupted.leaveHelp', "Nothing changes. Whatever differs from your last checkpoint appears under Changes since your last checkpoint."),
	decideLater: () => localize('positron.checkpoints.interrupted.decideLater', "Decide Later"),
};

const checkResult = {
	failedTitle: () => localize('positron.checkpoints.checkResult.failedTitle', "Project Check Did Not Pass"),
	changedTitle: () => localize('positron.checkpoints.checkResult.changedTitle', "Project Check Changed Files"),
	changedFiles: () => localize('positron.checkpoints.checkResult.changedFiles', "Files the check changed:"),
	editedFiles: () => localize('positron.checkpoints.checkResult.editedFiles', "Files the check changed on disk:"),
	filesChangedOnDisk: (count: number) => joinSentences([resultSentences.checkChangedFilesOnDisk(count)]),
};

const suggestions = {
	goodPlace: () => localize('positron.checkpoints.suggestions.goodPlace', "This looks like a good place for a checkpoint."),
};

const aiNotice = {
	heading: () => localize('positron.checkpoints.aiNotice.heading', "Descriptions of your changes"),
	disclosure: () => localize('positron.checkpoints.aiNotice.disclosure', "Checkpoints sends your changes to your configured model provider to describe them."),
	ok: () => localize('positron.checkpoints.aiNotice.ok', "OK"),
	turnOff: () => localize('positron.checkpoints.aiNotice.turnOff', "Turn off suggestions"),
	openSetting: () => localize('positron.checkpoints.aiNotice.openSetting', "Open the setting"),
};

const view = {
	title: () => localize('positron.checkpoints.view.title', "Checkpoints"),
	iconDescription: () => localize('positron.checkpoints.view.iconDescription', "View icon of the Checkpoints view."),
};

/**
 * Labels for the "Show git details" area. This is the only group that may use git words, and the
 * test that checks the other groups skips it by name.
 */
const gitDetails = {
	heading: () => localize('positron.checkpoints.gitDetails.heading', "Git details"),
	commitId: () => localize('positron.checkpoints.gitDetails.commitId', "Commit id"),
	branch: () => localize('positron.checkpoints.gitDetails.branch', "Branch"),
	upstream: () => localize('positron.checkpoints.gitDetails.upstream', "Upstream"),
	operationId: () => localize('positron.checkpoints.gitDetails.operationId', "Operation id"),
	gitCommands: () => localize('positron.checkpoints.gitDetails.gitCommands', "Git operations this action ran"),
	hookOutput: () => localize('positron.checkpoints.gitDetails.hookOutput', "Output of the project check"),
	rawDescription: () => localize('positron.checkpoints.gitDetails.rawDescription', "Description from git"),
};

export const Strings = {
	status,
	actions,
	changes,
	diff,
	history,
	results,
	undoRedo,
	collisions,
	sync,
	overlaps,
	start,
	kept,
	unsaved: ServiceStrings.unsaved,
	interrupted,
	checkResult,
	suggestions,
	aiNotice,
	view,
	gitDetails,
};
