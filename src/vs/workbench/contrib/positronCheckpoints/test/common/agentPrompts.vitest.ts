/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IChangeSet, ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { describeChangesJob } from '../../common/agent/describeChanges.js';
import { describeHistoryJob } from '../../common/agent/describeHistory.js';
import { describeProposalJob } from '../../common/agent/describeProposal.js';
import { fullSystemPrompt } from '../../common/agent/jobRunner.js';
import { proposeCombinationJob } from '../../common/agent/proposeCombination.js';
import { splitIntoChunksJob } from '../../common/agent/splitIntoChunks.js';
import { summarizeIncomingJob } from '../../common/agent/summarizeIncoming.js';

const changes: IChangeSet = {
	basis: 'b1',
	files: [{
		path: 'dose.R', status: 'modified', binary: false, sizeBytes: 400, tooLarge: false,
		hunks: [{ id: 'h1', header: '@@ -1 +1 @@', addedLines: 1, removedLines: 1, patch: '@@ -1 +1 @@\n-dose <- 5\n+dose <- 500\n' }],
	}],
};

const colleagueWork: ICheckpoint = {
	id: 'm1', title: 'Updated the dosing table', body: 'Used the new table.', authorName: 'Maya', authorIsMe: false, time: '2026-11-19T10:00:00Z', shared: true, partialFiles: [],
};

/** The prompt of every job, built from sample input that does not contain the word. */
function allPrompts(): [string, { systemPrompt: string; user: string }][] {
	return [
		['describe-changes', describeChangesJob.buildPrompt(changes)],
		['split-into-chunks', splitIntoChunksJob.buildPrompt(changes)],
		['describe-history', describeHistoryJob.buildPrompt({ checkpoint: colleagueWork, diff: 'File: dosing.csv (changed)' })],
		['describe-proposal', describeProposalJob.buildPrompt({ checkpoints: [{ id: 'aaa111', title: 'Switch the dose to mg/kg', body: '' }], changedPaths: ['dose.R'] })],
		['summarize-incoming', summarizeIncomingJob.buildPrompt({
			preview: { basis: 'b1', incoming: [colleagueWork], changedPaths: ['dosing.csv'], touchesLocalWork: false, overlaps: [], collisions: [] },
			incomingDiff: 'File: dosing.csv (changed)',
			myChangedPaths: ['plot_dose.R'],
		})],
		['propose-combination', proposeCombinationJob.buildPrompt({
			overlap: { id: 'o1', kind: 'text', path: 'dose.R', otherPaths: [], base: 'cap <- 450\n', mine: 'cap <- 500\n', theirs: 'cap <- 400\n', theirAuthor: 'Maya', detail: '' },
			contextBefore: '', contextAfter: '', language: 'r',
		})],
	];
}

describe('agent prompts', () => {
	test('no prompt sent to the model contains the word checkpoint', () => {
		const offenders = allPrompts()
			.flatMap(([name, { systemPrompt, user }]) => [`${name} system: ${fullSystemPrompt(systemPrompt)}`, `${name} user: ${user}`])
			.filter(text => /checkpoint/i.test(text));
		expect(offenders).toEqual([]);
	});
});
