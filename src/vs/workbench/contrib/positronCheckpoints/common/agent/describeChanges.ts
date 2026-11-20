/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeRegExpCharacters } from '../../../../../base/common/strings.js';
import { IChangeSet } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { CHECKPOINT_TITLE_LIMIT } from '../checkpointsLimits.js';
import { FORBIDDEN_WORDS } from '../forbiddenWords.js';
import { renderChangesForModel } from './diffText.js';
import { Job, MAX_INPUT_CHARS, STYLE_SECOND_PERSON, wrapUntrusted } from './jobTypes.js';

/** The longest summary the view shows. */
export const MAX_SUMMARY_CHARS = 600;

/** The longest note for one file. */
export const MAX_FILE_NOTE_CHARS = 120;

/** The shortest file name that is removed before the check for git words. */
const MIN_REMOVED_NAME_CHARS = 3;

/**
 * Room in a request for the text around the changes: the wrapping of `wrapUntrusted` and the
 * instructions of the user prompt. The changes get the rest of `MAX_INPUT_CHARS`.
 */
export const PROMPT_ALLOWANCE_CHARS = 1000;

/** A description of the changes since the last checkpoint. */
export interface IChangesDescription {
	/** One line of at most 72 characters, usable as the title of a checkpoint. */
	title: string;
	/** A few sentences about what changed and why it matters. */
	summary: string;
	/** A short note for some or all of the changed files. */
	fileNotes: { path: string; note: string }[];
}

/** The title trimmed, when it is one line of 1 to 72 characters; otherwise undefined. */
export function checkTitle(raw: unknown): string | undefined {
	if (typeof raw !== 'string' || /[\r\n]/.test(raw)) {
		return undefined;
	}
	const title = raw.trim();
	return title.length >= 1 && title.length <= CHECKPOINT_TITLE_LIMIT ? title : undefined;
}

/**
 * True when `text` has a git word the view never shows. The paths and names of the changed files
 * are removed first, so a file called `merge.R` can be named. A name is removed only where it
 * stands as a whole token (no letter, digit, or underscore on either side), only when it has at
 * least 3 characters, so a file called `e` cannot split the word "merge", and only when it is not
 * itself a git word, so a file or author called `push` does not let the word through.
 */
export function containsForbiddenWord(text: string, paths: readonly string[]): boolean {
	const names = new Set<string>();
	for (const path of paths) {
		names.add(path);
		names.add(path.slice(path.lastIndexOf('/') + 1));
	}
	let cleaned = text;
	const removable = [...names].filter(name => name.length >= MIN_REMOVED_NAME_CHARS && !isForbiddenWord(name));
	for (const name of removable.sort((a, b) => b.length - a.length)) {
		cleaned = cleaned.replace(new RegExp(`(?<!\\w)${escapeRegExpCharacters(name)}(?!\\w)`, 'g'), ' ');
	}
	return FORBIDDEN_WORDS.test(cleaned);
}

/** True when the whole of `name`, without surrounding whitespace, is one git word. */
function isForbiddenWord(name: string): boolean {
	const match = FORBIDDEN_WORDS.exec(name.trim());
	return match !== null && match[0].length === name.trim().length;
}

/** True when `text` starts with the word "You", which a text about a colleague's work never does. */
export function startsWithYou(text: string): boolean {
	return /^you\s/i.test(text.trim());
}

/** The value of `key` in `raw` when `raw` is a plain object, otherwise undefined. */
export function field(raw: unknown, key: string): unknown {
	return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}

const SYSTEM_PROMPT = [
	'You describe the changes a person made to the files of their project since they last saved a version of their work.',
	'Answer with a JSON object of this form:',
	'{"title": "...", "summary": "...", "fileNotes": [{"path": "...", "note": "..."}]}',
	`- "title" is one line of at most ${CHECKPOINT_TITLE_LIMIT} characters that names the work, for example "Fixed the units in the dose model".`,
	`- "summary" is one to three sentences, at most ${MAX_SUMMARY_CHARS} characters, about what changed and why it matters.`,
	`- "fileNotes" has at most one short note for each changed file, a few words long and at most ${MAX_FILE_NOTE_CHARS} characters. "path" is the exact path from a "File:" line.`,
	STYLE_SECOND_PERSON,
].join('\n');

/**
 * Describes the unrecorded changes in plain language: a title, a summary, and a note per file.
 * The check accepts only a one-line title of 1 to 72 characters, a summary of 1 to 600
 * characters, notes of at most 120 characters for files in the change set (one each), and text
 * without git words.
 */
export const describeChangesJob: Job<IChangeSet, IChangesDescription> = {
	name: 'describe-changes',
	weight: 'light',
	version: 4,

	buildPrompt(changes) {
		const text = renderChangesForModel(changes, MAX_INPUT_CHARS - PROMPT_ALLOWANCE_CHARS);
		return {
			systemPrompt: SYSTEM_PROMPT,
			user: [
				'Describe these changes.',
				wrapUntrusted('the changes to the files since the last version', text),
			].join('\n\n'),
		};
	},

	check(raw, changes) {
		const paths = changes.files.map(file => file.path);
		const title = checkTitle(field(raw, 'title'));
		const summary = field(raw, 'summary');
		const notes = field(raw, 'fileNotes');
		if (title === undefined || typeof summary !== 'string' || !Array.isArray(notes)) {
			return undefined;
		}
		const trimmedSummary = summary.trim();
		if (trimmedSummary.length === 0 || trimmedSummary.length > MAX_SUMMARY_CHARS) {
			return undefined;
		}

		const known = new Set(paths);
		const fileNotes: IChangesDescription['fileNotes'] = [];
		for (const entry of notes) {
			const path = field(entry, 'path');
			const note = field(entry, 'note');
			if (typeof path !== 'string' || typeof note !== 'string' || !known.has(path) || fileNotes.some(existing => existing.path === path)) {
				return undefined;
			}
			const trimmedNote = note.trim();
			if (trimmedNote.length > MAX_FILE_NOTE_CHARS) {
				return undefined;
			}
			fileNotes.push({ path, note: trimmedNote });
		}

		const texts = [title, trimmedSummary, ...fileNotes.map(entry => entry.note)];
		if (texts.some(text => containsForbiddenWord(text, paths))) {
			return undefined;
		}
		return { title, summary: trimmedSummary, fileNotes };
	},
};
