/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOverlap } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../checkpointsStrings.js';
import { containsForbiddenWord, field } from './describeChanges.js';
import { Job, MAX_INPUT_CHARS, wrapUntrusted } from './jobTypes.js';

/** The number of lines of the working file read on each side of the overlap. */
export const CONTEXT_LINES = 40;

/** The longest explanation of what one person did. */
export const MAX_EXPLANATION_CHARS = 200;

/** The longest reason the view shows. */
export const MAX_REASON_CHARS = 300;

/** Above this share of lines that are in no version, a combination is low confidence. */
export const MAX_NEW_LINE_SHARE = 0.4;

/**
 * Room in a request for the text around the versions: the instructions, the wrapping of six
 * `wrapUntrusted` blocks, and the name, language, and colleague block.
 */
const PROMPT_ALLOWANCE_CHARS = 3000;

/** What the "propose combination" job reads for one text overlap. */
export interface IProposeCombinationInput {
	overlap: IOverlap;
	/** Up to `CONTEXT_LINES` lines of the working file before the overlapping part. */
	contextBefore: string;
	/** Up to `CONTEXT_LINES` lines of the working file after the overlapping part. */
	contextAfter: string;
	/** The language of the file, such as `r` or `python`, or `plaintext`. */
	language: string;
}

/** A combined text for a text overlap, with what each person did. */
export interface ICombinationProposal {
	/** What the person changed, as a phrase without a subject, shown after "You:". */
	mineDid: string;
	/** What the colleague changed, in the same form, shown after their name. */
	theirsDid: string;
	/** The text that replaces the person's version when the person accepts it and applies. */
	combined: string;
	/** `high` only when the model is sure and the check found nothing that lowers it. */
	confidence: 'high' | 'low';
	/** Why the combination is right, or what is uncertain about it. */
	reason: string;
}

/** The lines of `text`, without line endings and without trailing whitespace. */
function normalizedLines(text: string): string[] {
	return text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/).map(line => line.trimEnd());
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** True when `line` is a line git writes around the two sides of an overlap. */
function isMarkerLine(line: string): boolean {
	return line.startsWith('<<<<<<<') || line.startsWith('>>>>>>>') || line === '=======';
}

/**
 * The lines of the working file around the person's version of an overlap: up to
 * `CONTEXT_LINES` lines before the first line of `mine` found in the file, and up to as many after
 * the lines of `mine` from there. Lines are compared without trailing whitespace. When `mine` is
 * empty or its first line is not in the file, there is no context.
 */
export function contextAround(fileText: string, mine: string): { contextBefore: string; contextAfter: string } {
	const mineLines = normalizedLines(mine);
	if (mineLines.length === 0) {
		return { contextBefore: '', contextAfter: '' };
	}
	const fileLines = fileText === '' ? [] : fileText.replace(/\r?\n$/, '').split(/\r?\n/);
	const start = fileLines.findIndex(line => line.trimEnd() === mineLines[0]);
	if (start === -1) {
		return { contextBefore: '', contextAfter: '' };
	}
	const end = Math.min(fileLines.length, start + mineLines.length);
	const join = (lines: string[]) => lines.length === 0 ? '' : lines.join('\n') + '\n';
	return {
		contextBefore: join(fileLines.slice(Math.max(0, start - CONTEXT_LINES), start)),
		contextAfter: join(fileLines.slice(end, end + CONTEXT_LINES)),
	};
}

/** The number of characters of the three versions of an overlap. */
function versionsLength(overlap: IOverlap): number {
	return (overlap.base ?? '').length + (overlap.mine ?? '').length + (overlap.theirs ?? '').length;
}

/**
 * True when the overlap is a text overlap whose three versions fit in one request. A larger one
 * gets no proposal, because a shortened version cannot be combined correctly.
 */
export function fitsInOneRequest(overlap: IOverlap): boolean {
	return overlap.kind === 'text' && versionsLength(overlap) + PROMPT_ALLOWANCE_CHARS <= MAX_INPUT_CHARS;
}

/** The last lines of `text` that fit in `maxChars`, whole lines only. */
function lastLines(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	const cut = text.indexOf('\n', text.length - maxChars - 1);
	return cut === -1 ? '' : text.slice(cut + 1);
}

/** The first lines of `text` that fit in `maxChars`, whole lines only. */
function firstLines(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	const cut = text.lastIndexOf('\n', maxChars - 1);
	return cut === -1 ? '' : text.slice(0, cut + 1);
}

/** A trimmed text of 1 to `maxChars` characters, or undefined. */
function checkText(raw: unknown, maxChars: number): string | undefined {
	if (typeof raw !== 'string') {
		return undefined;
	}
	const text = raw.trim();
	return text.length >= 1 && text.length <= maxChars ? text : undefined;
}

const SYSTEM_PROMPT = [
	'A person and a colleague changed the same lines of a file in their project. You propose one combined text that keeps the purpose of both changes.',
	'Answer with a JSON object of this form:',
	'{"mineDid": "...", "theirsDid": "...", "combined": "...", "confidence": "high", "reason": "..."}',
	`- "mineDid" says what the person changed, compared with the version before either change. Write a phrase in the past tense without a subject, at most ${MAX_EXPLANATION_CHARS} characters, for example "raised the dose cap to 500 mg".`,
	'- "theirsDid" says what the colleague changed, in the same form.',
	'- "combined" is the full text that replaces the person\'s version. It keeps both changes. Use the lines of the two versions, and change a line only where that is needed to keep both changes. Never add marker lines such as <<<<<<<, =======, or >>>>>>>. End it with a line break when both versions end with one.',
	'- "confidence" is "high" only when both changes clearly fit together and "combined" keeps both of them. Otherwise it is "low".',
	`- "reason" is one or two sentences, at most ${MAX_REASON_CHARS} characters, that say why the combined text is right or what is uncertain about it.`,
].join('\n');

/**
 * Proposes a combined text for one text overlap (spec 6.4 and 7). The check accepts only a text
 * overlap, explanations of 1 to 200 characters and a reason of 1 to 300 characters without git
 * words, and a combined text with no marker lines that is empty only when a version is empty and
 * ends with a line break when both the person's and the colleague's versions do. A combined text
 * equal to the version before both changes (when both changed it), equal to one version, without
 * any line that a side added, or with more than 40 percent of its lines in no version, is lowered to
 * `low` confidence with a reason that says why. Lines are compared without trailing whitespace.
 */
export const proposeCombinationJob: Job<IProposeCombinationInput, ICombinationProposal> = {
	name: 'propose-combination',
	weight: 'careful',
	version: 1,

	buildPrompt({ overlap, contextBefore, contextAfter, language }) {
		const contextBudget = Math.max(0, MAX_INPUT_CHARS - PROMPT_ALLOWANCE_CHARS - versionsLength(overlap) - overlap.path.length - overlap.theirAuthor.length);
		return {
			systemPrompt: SYSTEM_PROMPT,
			user: [
				'Combine the person\'s version and the colleague\'s version of the changed part of this file.',
				wrapUntrusted('the name of the file, its language, and the name of the colleague', `File: ${overlap.path}\nLanguage: ${language}\nColleague: ${overlap.theirAuthor}`),
				wrapUntrusted('the lines of the file just before the changed part', lastLines(contextBefore, Math.floor(contextBudget / 2))),
				wrapUntrusted('the changed part as it was before either change', overlap.base ?? ''),
				wrapUntrusted('the person\'s version of the changed part', overlap.mine ?? ''),
				wrapUntrusted('the colleague\'s version of the changed part', overlap.theirs ?? ''),
				wrapUntrusted('the lines of the file just after the changed part', firstLines(contextAfter, Math.floor(contextBudget / 2))),
			].join('\n\n'),
		};
	},

	check(raw, { overlap }) {
		if (overlap.kind !== 'text') {
			return undefined;
		}
		const names = [overlap.path, ...overlap.otherPaths, overlap.theirAuthor];
		const mineDid = checkText(field(raw, 'mineDid'), MAX_EXPLANATION_CHARS);
		const theirsDid = checkText(field(raw, 'theirsDid'), MAX_EXPLANATION_CHARS);
		const reason = checkText(field(raw, 'reason'), MAX_REASON_CHARS);
		const combined = field(raw, 'combined');
		const confidence = field(raw, 'confidence');
		if (mineDid === undefined || theirsDid === undefined || reason === undefined || typeof combined !== 'string' || (confidence !== 'high' && confidence !== 'low')) {
			return undefined;
		}
		if ([mineDid, theirsDid, reason].some(text => containsForbiddenWord(text, names))) {
			return undefined;
		}

		const base = overlap.base ?? '';
		const mine = overlap.mine ?? '';
		const theirs = overlap.theirs ?? '';
		if (combined === '' && base !== '' && mine !== '' && theirs !== '') {
			return undefined;
		}
		if (combined !== '' && mine.endsWith('\n') && theirs.endsWith('\n') && !combined.endsWith('\n')) {
			return undefined;
		}
		const known = new Set([base, mine, theirs].flatMap(normalizedLines));
		const lines = normalizedLines(combined);
		// A marker line is refused unless a version has that very line, as a heading underlined
		// with equals signs can.
		if (lines.some(line => isMarkerLine(line) && !known.has(line))) {
			return undefined;
		}

		const proposal: ICombinationProposal = { mineDid, theirsDid, combined, confidence, reason };
		if (sameLines(lines, normalizedLines(mine)) || sameLines(lines, normalizedLines(theirs))) {
			return { ...proposal, confidence: 'low', reason: Strings.overlaps.oneSideKept() };
		}
		// A text equal to the version before both changes drops both, unless a side did not change.
		const baseLines = normalizedLines(base);
		if (sameLines(lines, baseLines) && !sameLines(normalizedLines(mine), baseLines) && !sameLines(normalizedLines(theirs), baseLines)) {
			return { ...proposal, confidence: 'low', reason: Strings.overlaps.dropsBothChanges() };
		}
		const newLines = lines.filter(line => !known.has(line)).length;
		if (lines.length > 0 && newLines / lines.length > MAX_NEW_LINE_SHARE) {
			return { ...proposal, confidence: 'low', reason: Strings.overlaps.mostlyNewLines() };
		}
		// A side that added lines has dropped them all when none of them is in the combination.
		const inCombination = new Set(lines);
		const inBase = new Set(baseLines);
		const dropsASide = [mine, theirs].some(side => {
			const added = normalizedLines(side).filter(line => !inBase.has(line));
			return added.length > 0 && !added.some(line => inCombination.has(line));
		});
		if (dropsASide) {
			return { ...proposal, confidence: 'low', reason: Strings.overlaps.oneSideKept() };
		}
		return proposal;
	},
};
