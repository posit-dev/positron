/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChangeSet } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { checkTitle, containsForbiddenWord, field, MAX_SUMMARY_CHARS, PROMPT_ALLOWANCE_CHARS } from './describeChanges.js';
import { renderHunksForModel } from './diffText.js';
import { Job, MAX_INPUT_CHARS, wrapUntrusted } from './jobTypes.js';

/** The most chunks a proposal can have. */
export const MAX_PROPOSED_CHUNKS = 8;

/** One proposed checkpoint. */
export interface IProposedChunk {
	title: string;
	summary: string;
	/** The parts of text files in this checkpoint. */
	hunkIds: string[];
	/** The files without parts in this checkpoint. */
	wholeFiles: string[];
	/** True when the work in this checkpoint looks done. */
	finished: boolean;
}

/** A proposal to record the unrecorded changes as several checkpoints. */
export interface IChunkProposal {
	chunks: IProposedChunk[];
}

const SYSTEM_PROMPT = [
	'You sort the changes a person made to the files of their project into checkpoints, one for each separate piece of work, so that each checkpoint can be saved on its own.',
	'The changes are listed as parts. Each part of a file has an id on its "Part <id> of <path>" line. A file that has no parts is listed on a "Whole file <path>" line.',
	'Answer with a JSON object of this form:',
	'{"chunks": [{"title": "...", "summary": "...", "hunkIds": ["..."], "wholeFiles": ["..."], "finished": true}]}',
	`- Use 1 to ${MAX_PROPOSED_CHUNKS} checkpoints. Keep parts that belong to the same piece of work together.`,
	'- Put the id of every part in "hunkIds" of exactly one checkpoint. Put the path of every whole file in "wholeFiles" of exactly one checkpoint. Use only the ids and paths that are listed.',
	'- "title" is one line of at most 72 characters that names the work. "summary" is one or two sentences about it.',
	'- "finished" is true when the work in the checkpoint looks complete, and false when it looks started but not done.',
].join('\n');

/**
 * Splits the unrecorded changes into suggested checkpoints. The check accepts 1 to 8 chunks whose
 * hunk ids and file paths are exactly a partition of the input: every hunk of every text file
 * once, every file without hunks once in `wholeFiles`, and nothing else. Titles and summaries
 * follow the rules of `describeChangesJob`.
 */
export const splitIntoChunksJob: Job<IChangeSet, IChunkProposal> = {
	name: 'split-into-chunks',
	weight: 'careful',
	version: 1,

	buildPrompt(changes) {
		const text = renderHunksForModel(changes, MAX_INPUT_CHARS - PROMPT_ALLOWANCE_CHARS);
		if (text === undefined) {
			throw new Error('The changes have too many parts to list in one request.');
		}
		return {
			systemPrompt: SYSTEM_PROMPT,
			user: [
				'Sort these changes into checkpoints.',
				wrapUntrusted('the changes to the files since the last checkpoint, as parts', text),
			].join('\n\n'),
		};
	},

	check(raw, changes) {
		const rawChunks = field(raw, 'chunks');
		if (!Array.isArray(rawChunks) || rawChunks.length < 1 || rawChunks.length > MAX_PROPOSED_CHUNKS) {
			return undefined;
		}

		const paths = changes.files.map(file => file.path);
		// Each hunk id and each file without hunks, and whether a chunk has named it yet.
		const unplacedHunks = new Set(changes.files.flatMap(file => file.hunks.map(hunk => hunk.id)));
		const unplacedFiles = new Set(changes.files.filter(file => file.hunks.length === 0).map(file => file.path));

		const chunks: IProposedChunk[] = [];
		for (const rawChunk of rawChunks) {
			const title = checkTitle(field(rawChunk, 'title'));
			const summary = field(rawChunk, 'summary');
			const hunkIds = field(rawChunk, 'hunkIds');
			const wholeFiles = field(rawChunk, 'wholeFiles');
			const finished = field(rawChunk, 'finished');
			if (title === undefined || typeof summary !== 'string' || summary.trim().length > MAX_SUMMARY_CHARS || typeof finished !== 'boolean') {
				return undefined;
			}
			if (!isStringArray(hunkIds) || !isStringArray(wholeFiles) || hunkIds.length + wholeFiles.length === 0) {
				return undefined;
			}
			// An unknown id or path, or one a chunk already named, fails the check.
			if (!hunkIds.every(id => unplacedHunks.delete(id)) || !wholeFiles.every(path => unplacedFiles.delete(path))) {
				return undefined;
			}
			if (containsForbiddenWord(title, paths) || containsForbiddenWord(summary, paths)) {
				return undefined;
			}
			chunks.push({ title, summary: summary.trim(), hunkIds: [...hunkIds], wholeFiles: [...wholeFiles], finished });
		}
		// Every hunk and every file without hunks is in some chunk.
		return unplacedHunks.size === 0 && unplacedFiles.size === 0 ? { chunks } : undefined;
	},
};

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}
