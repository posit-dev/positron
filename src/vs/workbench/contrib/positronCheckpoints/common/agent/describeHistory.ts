/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { CHECKPOINT_TITLE_LIMIT } from '../checkpointsLimits.js';
import { checkTitle, containsForbiddenWord, field, PROMPT_ALLOWANCE_CHARS, startsWithYou } from './describeChanges.js';
import { Job, MAX_INPUT_CHARS, STYLE_THIRD_PERSON, wrapUntrusted } from './jobTypes.js';

/** The longest summary of a colleague's checkpoint. */
export const MAX_HISTORY_SUMMARY_CHARS = 400;

/** What the "describe history" job reads for one checkpoint. */
export interface IDescribeHistoryInput {
	/** A checkpoint a colleague made. */
	checkpoint: ICheckpoint;
	/**
	 * The changes of the checkpoint as text, or an empty string when they are not known. The
	 * prompt has a block for the changes only when this is not empty.
	 */
	diff: string;
}

/** A plain-language description of a colleague's checkpoint. */
export interface IHistoryDescription {
	/** One line of at most 72 characters, shown in place of the original title. */
	title: string;
	/** A few sentences, shown in place of the original description. */
	summary: string;
}

const SYSTEM_PROMPT = [
	'A colleague of a person saved a checkpoint of their work in a shared project and wrote a short message about it, often in technical shorthand. You rewrite the message in plain language for the person.',
	'Answer with a JSON object of this form:',
	'{"title": "...", "summary": "..."}',
	`- "title" is one line of at most ${CHECKPOINT_TITLE_LIMIT} characters that names the work, for example "Changed the dose units to mg/kg".`,
	`- "summary" is one or two sentences, at most ${MAX_HISTORY_SUMMARY_CHARS} characters, about what the colleague changed and why it matters. Name the colleague by the name given and write in the third person, for example "Maya changed the dose calculation to use body weight."`,
	'- Use only what the message and the changes show. When the message says little, keep the title close to it.',
	STYLE_THIRD_PERSON,
].join('\n');

/**
 * Rewrites the message of a colleague's checkpoint in plain language (spec 7). The check accepts
 * only a one-line title of 1 to 72 characters and a summary of 1 to 400 characters without git
 * words that does not start with "You ", and never describes the person's own checkpoint.
 */
export const describeHistoryJob: Job<IDescribeHistoryInput, IHistoryDescription> = {
	name: 'describe-history',
	weight: 'light',
	version: 2,

	buildPrompt({ checkpoint, diff }) {
		const maxChars = MAX_INPUT_CHARS - PROMPT_ALLOWANCE_CHARS;
		const message = [`Author: ${checkpoint.authorName}`, checkpoint.title, checkpoint.body].filter(part => part !== '').join('\n\n').slice(0, maxChars);
		const blocks = [
			'Rewrite this checkpoint message in plain language.',
			wrapUntrusted('the colleague\'s name and the message they wrote', message),
		];
		if (diff !== '') {
			const budget = Math.max(0, maxChars - message.length);
			blocks.push(wrapUntrusted('the changes of the checkpoint', diff.slice(0, budget)));
		}
		return { systemPrompt: SYSTEM_PROMPT, user: blocks.join('\n\n') };
	},

	check(raw, { checkpoint }) {
		if (checkpoint.authorIsMe) {
			return undefined;
		}
		const title = checkTitle(field(raw, 'title'));
		const summary = field(raw, 'summary');
		if (title === undefined || typeof summary !== 'string') {
			return undefined;
		}
		const trimmedSummary = summary.trim();
		if (trimmedSummary.length === 0 || trimmedSummary.length > MAX_HISTORY_SUMMARY_CHARS || startsWithYou(trimmedSummary)) {
			return undefined;
		}
		if ([title, trimmedSummary].some(text => containsForbiddenWord(text, [checkpoint.authorName]))) {
			return undefined;
		}
		return { title, summary: trimmedSummary };
	},
};
