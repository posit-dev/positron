/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Strings } from '../../common/checkpointsStrings.js';
import { FORBIDDEN_WORDS } from '../../common/forbiddenWords.js';
import { IIncomingPreview, OperationResult, RejectedReason, UnavailableReason, UnusualKind } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';

const unavailableReasons: UnavailableReason[] = ['busy', 'unusual-state', 'git-too-old', 'not-tracking', 'stale-operation-id', 'not-undoable', 'shared-checkpoint', 'timed-out', 'nothing-to-do', 'occupied'];
const rejectedReasons: RejectedReason[] = ['shared-copy-moved', 'review-required', 'sign-in-required', 'no-shared-copy', 'offline', 'unknown'];
const unusualKinds: UnusualKind[] = ['detached', 'operation-in-progress', 'staged-differs', 'unrecovered', 'git-missing'];

const preview: IIncomingPreview = {
	basis: 'b',
	incoming: [{ id: 'c1', title: 'Changed units', body: '', authorName: 'Maya', authorIsMe: false, time: '2026-11-19T10:00:00Z', shared: true, partialFiles: [] }],
	changedPaths: ['dose.R'],
	touchesLocalWork: true,
	overlaps: [{ id: 'o1', kind: 'text', path: 'dose.R', otherPaths: [], theirAuthor: 'Maya', detail: '' }],
	collisions: [{ path: 'data.csv', reason: 'ignored', sizeBytes: 10 }],
};

const results: OperationResult[] = [
	{ kind: 'done', operationId: 'op', hookEditedFiles: [] },
	{ kind: 'done', operationId: 'op', hookEditedFiles: ['a.R', 'b.R'] },
	{ kind: 'check-failed', output: 'x', hookEditedFiles: [] },
	{ kind: 'check-failed', output: 'x', hookEditedFiles: ['a.R'] },
	{ kind: 'check-changed-checkpoint', token: 't', changedPaths: ['a.R'], hookEditedFiles: [] },
	{ kind: 'path-collisions', collisions: preview.collisions },
	{ kind: 'overlaps', preview },
	{ kind: 'inputs-changed', changed: ['mine', 'shared', 'files'], preview },
	{ kind: 'inputs-changed', changed: ['shared'], preview: { ...preview, incoming: [] } },
	{ kind: 'changes-moved' },
	{ kind: 'project-changed' },
	{ kind: 'could-not-finish', detail: 'd' },
	{ kind: 'interrupted' },
	...rejectedReasons.map((reason): OperationResult => ({ kind: 'rejected', reason, detail: 'git said no' })),
	...unavailableReasons.map((reason): OperationResult => ({ kind: 'unavailable', reason, detail: 'd' })),
];

/**
 * Sample arguments for every function in every group except `gitDetails`. A function with no entry
 * here fails the coverage test, so a new string cannot skip the vocabulary check.
 */
const samples: Record<string, Record<string, unknown[][]>> = {
	status: {
		noEngine: [[]], couldNotRead: [[]], interrupted: [['Getting Maya\'s changes']], syncUnavailable: [['2.40']], behind: [[1], [2]],
		partOfProject: [['dose-model']], onlyOnThisComputer: [[]], notKeepingCheckpoints: [[]], identityMissing: [[]], upToDate: [[]],
		waitingToSend: [[1], [3]], incoming: [['Maya', 1], ['Maya', 2]], incomingWithoutAuthor: [[1], [2]],
		incomingTouchesWork: [[]], incomingSeparate: [[]], lastChecked: [['2 minutes ago']],
		recoveryNotice: [['reversed'], ['completed']], recoverySnapshot: [[]], pendingApproval: [[]], pendingOverlap: [[]],
		unusual: unusualKinds.map(kind => [kind]), unusualHelp: [[]], needsGitTool: [[]],
	},
	actions: {
		createCheckpoint: [[]], createCheckpoints: [[1], [2]], getChanges: [[]], getAuthorsChanges: [['Maya']], sendChanges: [[]],
		checkSharedCopy: [[]], goBack: [[]], reverseCheckpoint: [[]], editDescription: [[]], startKeepingCheckpoints: [[]],
		viewDetailedDifferences: [[]], viewDetailedDifferencesOf: [['dose.R']], showGitDetails: [[]], edit: [[]], dismiss: [[]], accept: [[]], chooseMyself: [[]], backOut: [[]],
		cancel: [[]], undo: [['Get Maya\'s changes']], redo: [['Get Maya\'s changes']], undoLastAction: [[]], undoProjectCheckChanges: [[]],
		undoHover: [[50, 30]], acceptCheckedCheckpoint: [[]], declineCheckedCheckpoint: [[]], reverseKeepNewer: [[]], leaveAsIs: [[]],
		removeRecoverySnapshot: [[]], openSourceControl: [[]], useTheirsKeepCopy: [[]],
		close: [[]], reviewCheckChanges: [[]], removeRecoverySnapshotAt: [['2 minutes ago']],
	},
	changes: {
		heading: [[]], none: [[]], unsavedNote: [[1], [2]], fileCount: [[1], [3]], newFile: [[]], deletedFile: [[]],
		renamedFile: [[]], previousName: [['old.R']], changedFile: [[]], binaryFile: [['2 MB']], tooLarge: [['big.csv', 50]],
		titleTooLong: [[72]], chunkTitle: [[1]], dialogTitle: [[]], titleLabel: [[]], bodyLabel: [[]],
		addAnotherCheckpoint: [[]], moveFileTo: [['dose.R']], partLabel: [[2, 3, 1]], movePartTo: [[2, 'dose.R']], noFilesInChunk: [[]],
		savedAndAdded: [[1], [2]], savedAndAddedTag: [[]], savedAndChanged: [[]], savedContentChanged: [[]],
	},
	diff: {
		changeTitle: [['dose.R']], sizes: [['1 MB', '2 MB'], ['1 MB', undefined], [undefined, '2 MB']],
		binaryMessage: [['plot.png', 'Before: 1 MB. Now: 2 MB.']], tooLargeMessage: [['big.csv', 50, 'Now: 80 MB.']], unavailable: [['dose.R']], pendingTitle: [['dose.R']],
	},
	history: {
		heading: [[]], empty: [[]], you: [[]], notYetShared: [[]], partialFiles: [[['dose.R']], [['a.R', 'b.R']]],
		returnedTo: [['Tuesday\'s version']], loadMore: [[]], showDetails: [['Fixed the plot']], editDialogTitle: [[]], editSave: [[]],
		reverseDialogTitle: [[]], reverseExplain: [['Fixed the plot']], reverseConfirm: [[]],
	},
	results: {
		checkFailed: [[]], checkChangedCheckpoint: [[]], checkChangedFilesOnDisk: [[1], [2]], createAgain: [[]], couldNotFinish: [[]],
		interrupted: [[]], interruptedBy: [['Getting Maya\'s changes', 1], ['Getting Maya\'s changes', 2]], changesMoved: [[]],
		projectChanged: [[]], overlaps: [[1], [2]], pathCollisions: [[]], inputsChangedShared: [['Maya']], inputsChangedSharedUnknown: [[]],
		inputsChangedFiles: [[]], inputsChangedMine: [[]], reviewAgain: [[]],
		rejected: rejectedReasons.map(reason => [reason]), unavailable: unavailableReasons.map(reason => [reason]),
		forOperation: results.map(result => [result]),
	},
	undoRedo: { filesChangedSince: [[1], [3]], expired: [[]] },
	collisions: {
		explainWithAuthor: [['Maya', 'data.csv']], explainIgnored: [['data.csv']], explainTooLarge: [['data.csv', '80 MB']], keepCopyHelp: [['data.csv']],
		dialogTitle: [[]], continue: [[]], cancelled: [[]],
	},
	sync: { done: [[]], changedFiles: [[]], diffTitle: [['dose.R']] },
	overlaps: {
		heading: [[]], title: [['dose.R']], keepMine: [[]], keepTheirs: [['Maya']], keepBoth: [[]], keepEditedFile: [[]], acceptDeletion: [[]],
		newNameFor: [['dose.R']], textExplain: [['Maya', 'dose.R']], binaryExplain: [['Maya', 'plot.png']],
		editDeleteExplain: [['Maya', 'dose.R', 'me'], ['Maya', 'dose.R', 'them']], renameExplain: [['Maya', 'dose.R']],
		fileFolderExplain: [['Maya', 'out', 'me'], ['Maya', 'out', 'them']], unsupportedExplain: [['sub']], editorTitle: [['dose.R']], combinedText: [[]], mineLabel: [[]],
		theirsLabel: [['Maya']], baseLabel: [[]], applyChoices: [[]], keepName: [['dose.R']], sizes: [['1 MB', 'Maya', '2 MB']],
		newNameInvalid: [['plot.png']], mineNameLabel: [[]], copyNameLabel: [[]], combinedTextEmpty: [[]], choicesFor: [['dose.R']], chooseEach: [[]], none: [[]], editorLabel: [[]],
	},
	start: {
		dialogTitle: [[]], intro: [[]], startButton: [[]], identityWhy: [[]], nameLabel: [[]], emailLabel: [[]], emailInvalid: [[]],
		leaveOut: [[]], leaveOutBox: [[]], leaveOutHelp: [[]], couldNotLoad: [[]], tryAgain: [[]], identityNotRecorded: [[]],
	},
	kept: {
		heading: [[]], totalSize: [['120 MB']], restore: [[]], moveToAnotherPlace: [[]], delete: [[]], restoreOf: [['data.csv']], moveOf: [['data.csv']],
		deleteOf: [['data.csv']], deleteConfirm: [['data.csv']], deleteDetail: [[]], keptBy: [['Get Maya\'s changes']],
		chooseNewPlace: [['data.csv']], moveHere: [[]], outsideProject: [[]], couldNotLoad: [[]], tryAgain: [[]],
	},
	unsaved: {
		cancel: [[]], saveAndInclude: [[1], [2]], continueWithout: [[]], saveAllAndContinue: [[]], checkpointMessage: [[1], [2]], checkpointDetail: [[]],
		fileChangingMessage: [[1], [2]], fileChangingDetail: [[]], saveFailed: [['a.R', 1], ['a.R', 3]],
	},
	interrupted: {
		heading: [[]], changedFiles: [[]], stagedWork: [[]], dialogTitle: [[]], reviewButton: [[]], reverseHelp: [[]], leaveHelp: [[]], decideLater: [[]],
	},
	checkResult: { failedTitle: [[]], changedTitle: [[]], changedFiles: [[]], editedFiles: [[]], filesChangedOnDisk: [[1], [2]] },
	suggestions: { goodPlace: [[]], heading: [[]], badge: [[]] },
	aiNotice: { heading: [[]], disclosure: [[]], ok: [[]], turnOff: [[]], openSetting: [[]] },
	view: { title: [[]], iconDescription: [[]] },
};

type StringFunction = (...args: unknown[]) => string | undefined;

function groupsToCheck(): [string, Record<string, StringFunction>][] {
	return Object.entries(Strings)
		.filter(([name]) => name !== 'gitDetails')
		.map(([name, group]) => [name, group as unknown as Record<string, StringFunction>]);
}

describe('checkpointsStrings', () => {
	test('every string function has sample arguments', () => {
		const missing: string[] = [];
		for (const [groupName, group] of groupsToCheck()) {
			for (const functionName of Object.keys(group)) {
				if (!samples[groupName]?.[functionName]) {
					missing.push(`${groupName}.${functionName}`);
				}
			}
			for (const functionName of Object.keys(samples[groupName] ?? {})) {
				if (!Object.keys(group).includes(functionName)) {
					missing.push(`${groupName}.${functionName} (sample without a function)`);
				}
			}
		}
		expect(missing).toEqual([]);
	});

	test('no user-facing string contains a forbidden git word', () => {
		const offenders: string[] = [];
		let checked = 0;
		for (const [groupName, group] of groupsToCheck()) {
			for (const [functionName, fn] of Object.entries(group)) {
				for (const args of samples[groupName][functionName]) {
					const text = fn(...args);
					checked++;
					if (text !== undefined && FORBIDDEN_WORDS.test(text)) {
						offenders.push(`${groupName}.${functionName}: ${text}`);
					}
				}
			}
		}
		expect(checked).toBeGreaterThan(150);
		expect(offenders).toEqual([]);
	});

	test('every string function returns text except forOperation on a plain success', () => {
		for (const [groupName, group] of groupsToCheck()) {
			for (const [functionName, fn] of Object.entries(group)) {
				for (const args of samples[groupName][functionName]) {
					const text = fn(...args);
					if (groupName === 'results' && functionName === 'forOperation' && (args[0] as OperationResult).kind === 'done' && (args[0] as { hookEditedFiles: string[] }).hookEditedFiles.length === 0) {
						expect(text).toBeUndefined();
					} else {
						expect(text, `${groupName}.${functionName}`).toEqual(expect.any(String));
						expect((text as string).trim(), `${groupName}.${functionName}`).not.toBe('');
					}
				}
			}
		}
	});

	test('forOperation returns a sentence for every result kind and reason', () => {
		const sentences = results.map(result => Strings.results.forOperation(result));
		expect(sentences).toEqual([
			undefined,
			'The check also changed 2 files on disk.',
			'A check set up for this project did not pass.',
			'A check set up for this project did not pass. The check also changed 1 file on disk. Create the checkpoint again to include these changes.',
			'A check set up for this project also changed these files.',
			'Some files on this computer are in no checkpoint, and this action would replace them. Nothing has changed yet. Choose what to do with each file.',
			'1 change overlaps with your work. Choose how to combine them. Nothing has changed in your project yet.',
			'You created a checkpoint since you reviewed this. Maya added more changes since you reviewed this. One of the overlapping files changed since you reviewed this. The changes are shown again. Nothing was changed.',
			'More changes were added to the shared copy since you reviewed this. The changes are shown again. Nothing was changed.',
			'Your files changed while the checkpoints were being prepared. Nothing was created. Review the changes and try again.',
			'Another tool changed this project after that action. Nothing was changed.',
			'That action could not finish. Your project is as it was.',
			'That action was interrupted, and some files were changed while it ran. Choose what to do next.',
			'Someone added changes to the shared copy first. Get their changes, then send yours.',
			'The shared copy needs a colleague to review changes before they join it.',
			'Sign in to the service that hosts the shared copy, then try again.',
			'This project is only on this computer, so there is no shared copy.',
			'The shared copy could not be reached. Check your connection and try again.',
			'The shared copy did not accept the request.',
			'Another window is working on this project.',
			'This project is in a state Checkpoints cannot work with. See the message at the top of the view.',
			'Getting and sending changes needs git version 2.40 or newer. Update git to use them.',
			'This folder is not keeping checkpoints yet.',
			'That is no longer the latest action. The view has been refreshed.',
			'That action cannot be undone.',
			'This checkpoint is already in the shared copy, so it cannot be undone. Use Reverse This Checkpoint to make a new checkpoint with the opposite change.',
			'The project did not respond in time. No files were changed. Try again.',
			'There were no changes to act on, so no files were changed.',
			'A file is already in that place. Choose a new name or place for the kept file.',
		]);
	});

	test('every result sentence and project check sentence is complete', () => {
		const sentences = [
			...results.map(result => Strings.results.forOperation(result)).filter(sentence => sentence !== undefined),
			Strings.checkResult.filesChangedOnDisk(1),
			Strings.checkResult.filesChangedOnDisk(2),
		];
		expect(sentences.filter(sentence => !sentence.endsWith('.'))).toEqual([]);
	});

	test('the sentences the spec quotes appear verbatim', () => {
		expect(Strings.status.partOfProject('dose-model')).toBe('This folder is part of the project dose-model');
		expect(Strings.status.onlyOnThisComputer()).toBe('This project is only on this computer');
		expect(Strings.status.unusual('operation-in-progress')).toBe('Another git tool left this project in the middle of an operation');
		expect(Strings.status.recoveryNotice('reversed')).toBe('An action was interrupted when Positron closed. It has been reversed.');
		expect(Strings.status.recoveryNotice('completed')).toBe('An action was interrupted when Positron closed. It has been completed.');
		expect(Strings.status.recoverySnapshot()).toBe('Project as it was before recovery');
		expect(Strings.status.incoming('Maya', 2)).toBe('Maya added 2 checkpoints to the shared copy.');
		expect(Strings.status.needsGitTool()).toBe('This needs a git tool');
		expect(Strings.history.partialFiles(['dose.R'])).toBe('Contains part of the changes to dose.R');
		expect(Strings.history.returnedTo('Tuesday\'s version')).toBe('Returned to Tuesday\'s version');
		expect(Strings.results.interruptedBy('Getting Maya\'s changes', 2)).toBe('Getting Maya\'s changes was interrupted, and 2 files were changed afterwards.');
		expect(Strings.results.projectChanged()).toContain('Another tool changed this project after that action');
		expect(Strings.undoRedo.filesChangedSince(3)).toBe('You changed 3 files since then. Undo will set them back, and Redo will return them.');
		expect(Strings.collisions.explainWithAuthor('Maya', 'data.csv')).toBe('Maya added a file named data.csv. You have your own data.csv that is in no checkpoint.');
		expect(Strings.actions.useTheirsKeepCopy()).toBe('Use theirs and keep a copy of mine');
		expect(Strings.actions.undoProjectCheckChanges()).toBe('Undo: changes made by the project check');
		expect(Strings.actions.reverseKeepNewer()).toBe('Reverse the action and keep my newer files');
		expect(Strings.actions.leaveAsIs()).toBe('Leave the project as it is');
		expect(Strings.unsaved.saveAndInclude(2)).toBe('Save 2 files and include them');
		expect(Strings.unsaved.continueWithout()).toBe('Continue without the unsaved edits');
		expect(Strings.unsaved.saveAllAndContinue()).toBe('Save all and continue');
		expect(Strings.changes.unsavedNote(2)).toBe('2 files have unsaved edits that are not shown');
		expect(Strings.kept.heading()).toBe('Files kept aside');
		expect(Strings.suggestions.goodPlace()).toBe('This looks like a good place for a checkpoint.');
	});

	test('the unavailable sentences for an unusual state, a time-out, and nothing to do are exact', () => {
		expect(Strings.results.unavailable('unusual-state')).not.toContain('middle of an operation');
		expect(Strings.results.unavailable('timed-out')).toContain('No files were changed');
		expect(Strings.results.unavailable('nothing-to-do')).toContain('no changes to act on');
	});

	test('a failed save names the file and says the action was not started', () => {
		expect(Strings.unsaved.saveFailed('a.R', 1)).toBe('a.R could not be saved, so the action was not started. Files that were saved stay saved.');
		expect(Strings.unsaved.saveFailed('a.R', 3)).toBe('a.R and 2 more could not be saved, so the action was not started. Files that were saved stay saved.');
	});

	test('the staged-file sentence is plain', () => {
		expect(Strings.status.unusual('staged-differs')).toBe('Another git tool prepared part of a file for its own use, and it no longer matches the file you see.');
	});

	test('every unusual state has its own sentence', () => {
		const sentences = unusualKinds.map(kind => Strings.status.unusual(kind));
		expect(new Set(sentences).size).toBe(unusualKinds.length);
	});
});
