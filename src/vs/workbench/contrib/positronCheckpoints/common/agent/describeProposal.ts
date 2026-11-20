/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CHECKPOINT_TITLE_LIMIT } from '../checkpointsLimits.js';
import { checkTitle, field, PROMPT_ALLOWANCE_CHARS } from './describeChanges.js';
import { Job, MAX_INPUT_CHARS, wrapUntrusted } from './jobTypes.js';

/** The longest body of a proposal. A longer reply fails the check. */
export const MAX_PROPOSAL_BODY_CHARS = 4000;

/** The checkpoints and files that a proposal asks a colleague to review. */
export interface IDescribeProposalInput {
	/** The checkpoints of the proposal, oldest first. */
	checkpoints: { id: string; title: string; body: string }[];
	/** The paths of the files the proposal changes. */
	changedPaths: string[];
}

/** The title and the description that a colleague reads when asked to review a proposal. */
export interface IProposalDescription {
	/** One line of at most 72 characters. */
	title: string;
	/** Plain Markdown: a few sentences, then one line for each checkpoint. */
	body: string;
}

const SYSTEM_PROMPT = [
	'A person asks a colleague to review a set of checkpoints of their work in a shared project. You write the request: a title and a description.',
	'Answer with a JSON object of this form:',
	'{"title": "...", "body": "..."}',
	`- "title" is one line of at most ${CHECKPOINT_TITLE_LIMIT} characters that names the work, for example "Updated the dose model to use body weight".`,
	`- "body" is plain Markdown, at most ${MAX_PROPOSAL_BODY_CHARS} characters. It starts with a few sentences about what changed and why it matters. After a blank line it has one line for each checkpoint, in the order given, as a Markdown list item with the checkpoint's title.`,
	'- Use only what the checkpoints and the file names show.',
	'- Write as the person who made the changes, in the first person, for example "I changed the dose calculation to use body weight." The colleague who reads it is not named.',
].join('\n');

/**
 * Writes the title and the description of a proposal from the person's checkpoints and the files
 * they changed. The check accepts only a one-line title of 1 to 72 characters and a body of 1 to
 * 4000 characters. The cache key follows from the prompt, which has the id of every checkpoint.
 */
export const describeProposalJob: Job<IDescribeProposalInput, IProposalDescription> = {
	name: 'describe-proposal',
	weight: 'light',
	version: 1,

	buildPrompt({ checkpoints, changedPaths }) {
		const maxChars = MAX_INPUT_CHARS - PROMPT_ALLOWANCE_CHARS;
		const list = checkpoints
			.map(({ id, title, body }) => [`Checkpoint ${id}`, title, body].filter(part => part !== '').join('\n'))
			.join('\n\n')
			.slice(0, maxChars);
		const files = changedPaths.map(path => `File: ${path}`).join('\n').slice(0, Math.max(0, maxChars - list.length));
		const blocks = [
			'Write the title and the description of this request for review.',
			wrapUntrusted('the checkpoints of the request, each with its id, title, and description', list),
		];
		if (files !== '') {
			blocks.push(wrapUntrusted('the names of the changed files', files));
		}
		return { systemPrompt: SYSTEM_PROMPT, user: blocks.join('\n\n') };
	},

	check(raw) {
		const title = checkTitle(field(raw, 'title'));
		const body = field(raw, 'body');
		if (title === undefined || typeof body !== 'string') {
			return undefined;
		}
		const trimmedBody = body.trim();
		if (trimmedBody.length === 0 || trimmedBody.length > MAX_PROPOSAL_BODY_CHARS) {
			return undefined;
		}
		return { title, body: trimmedBody };
	},
};
