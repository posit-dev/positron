/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ISequence, LcsDiff } from '../../../../../base/common/diff/diff.js';
import { ContentRef, ICheckpointsEngineProxy, IIncomingPreview } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { containsForbiddenWord, field, PROMPT_ALLOWANCE_CHARS } from './describeChanges.js';
import { fitFilesToLength } from './diffText.js';
import { Job, MAX_INPUT_CHARS, wrapUntrusted } from './jobTypes.js';

/** The longest summary of incoming changes the view shows. */
export const MAX_INCOMING_SUMMARY_CHARS = 500;

/** The number of leading bytes that are searched for a zero byte, which marks a data file. */
const BINARY_SNIFF_BYTES = 8000;

/** The most lines, both sides together, that are compared line by line. A larger file is named only. */
const MAX_COMPARED_LINES = 20000;

/** The most files whose contents are read for one request. The other files are listed by name. */
const MAX_FILES_READ = 40;

/** The most files read from the engine at the same time. */
const MAX_PARALLEL_READS = 4;

/** The largest side of a file, in bytes, that is compared. A larger file is listed by name and size. */
const MAX_SIDE_BYTES = 512 * 1024;

/** How colleagues' changes relate to the person's own work. */
export type IncomingRelation = 'unrelated' | 'nearby' | 'overlapping';

const RELATIONS: readonly IncomingRelation[] = ['unrelated', 'nearby', 'overlapping'];

/** What the "summarize incoming" job reads. */
export interface ISummarizeIncomingInput {
	/** The engine's preview of the incoming changes, with its overlap result. */
	preview: IIncomingPreview;
	/** The incoming changes as text, from `renderIncomingForModel`. */
	incomingDiff: string;
	/** The files the person changed since their last checkpoint. */
	myChangedPaths: string[];
}

/** A plain-language summary of colleagues' changes. */
export interface IIncomingSummary {
	summary: string;
	relation: IncomingRelation;
}

/** One file's lines, for a line-by-line comparison. */
class LineSequence implements ISequence {
	constructor(private readonly _lines: string[]) { }

	getElements(): string[] {
		return this._lines;
	}
}

function splitLines(text: string): string[] {
	return text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
}

/** True when the first bytes of `bytes` have a zero byte. */
function isBinary(bytes: VSBuffer): boolean {
	return bytes.buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** The lines that differ between `before` and `after`, each group after a line that says where it is. */
function changedLines(before: string[], after: string[]): string[] {
	const changes = new LcsDiff(new LineSequence(before), new LineSequence(after)).ComputeDiff(false).changes;
	const lines: string[] = [];
	for (const change of changes) {
		lines.push(`@@ line ${change.originalStart + 1} before, line ${change.modifiedStart + 1} now @@`);
		for (let i = change.originalStart; i < change.originalStart + change.originalLength; i++) {
			lines.push(`-${before[i]}`);
		}
		for (let i = change.modifiedStart; i < change.modifiedStart + change.modifiedLength; i++) {
			lines.push(`+${after[i]}`);
		}
	}
	return lines;
}

/**
 * The texts of one incoming file, from the full one to the shortest: its changed lines, then its
 * "File:" line with line counts. A data file, a side that is a file on disk, or a file too large
 * to compare has its "File:" line only.
 */
async function renderIncomingFile(engine: ICheckpointsEngineProxy, path: string): Promise<string[]> {
	const { left, right } = await engine.getDiff({ kind: 'incoming', path });
	const read = async (ref: ContentRef): Promise<VSBuffer | undefined> => {
		switch (ref.kind) {
			case 'empty': return VSBuffer.alloc(0);
			case 'blob': return engine.readBlob(ref.oid);
			case 'file': return undefined;
		}
	};
	const [before, after] = await Promise.all([read(left), read(right)]);
	const status = left.kind === 'empty' ? 'new' : right.kind === 'empty' ? 'removed' : 'changed';
	if (!before || !after) {
		return [`File: ${path} (${status}, contents not shown)`];
	}
	if (before.byteLength > MAX_SIDE_BYTES || after.byteLength > MAX_SIDE_BYTES) {
		return [`File: ${path} (${status}, too large to compare, ${before.byteLength} bytes before, ${after.byteLength} bytes now, contents not shown)`];
	}
	if (isBinary(before) || isBinary(after)) {
		return [`File: ${path} (${status}, data file, ${before.byteLength} bytes before, ${after.byteLength} bytes now, contents not shown)`];
	}
	const beforeLines = splitLines(before.toString());
	const afterLines = splitLines(after.toString());
	if (beforeLines.length + afterLines.length > MAX_COMPARED_LINES) {
		return [`File: ${path} (${status}, ${beforeLines.length} lines before, ${afterLines.length} lines now, contents not shown)`];
	}
	const lines = changedLines(beforeLines, afterLines);
	const added = lines.filter(line => line.startsWith('+')).length;
	const removed = lines.filter(line => line.startsWith('-')).length;
	return [
		[`File: ${path} (${status})`, ...lines].join('\n'),
		`File: ${path} (${status}, +${added} -${removed} lines, contents not shown)`,
	];
}

/**
 * The incoming changes of `preview` as text for a model request, at most `maxChars` characters
 * long. Each changed file is a "File:" line followed by its changed lines, read from both sides of
 * the engine's comparison. A data file (a zero byte in its first 8000 bytes) and a file with a side
 * over 512 KB appear as their name and sizes only. At most 4 files are read at a time, at most 40
 * files are read, and reading stops once the full texts reach `maxChars`; the other files appear
 * as their name only. When the text is too long, files are shortened largest first to their "File:"
 * line, and then the last files are left out.
 */
export async function renderIncomingForModel(engine: ICheckpointsEngineProxy, preview: IIncomingPreview, maxChars: number): Promise<string> {
	const paths = preview.changedPaths;
	const forms: string[][] = paths.map(path => [`File: ${path} (contents not shown)`]);
	let next = 0;
	let length = 0;
	const worker = async () => {
		while (length < maxChars && next < Math.min(paths.length, MAX_FILES_READ)) {
			const index = next++;
			forms[index] = await renderIncomingFile(engine, paths[index]);
			length += forms[index][0].length + 1;
		}
	};
	await Promise.all(Array.from({ length: MAX_PARALLEL_READS }, worker));
	return fitFilesToLength(forms, maxChars);
}

/** The list of incoming checkpoints, for the prompt. */
function listCheckpoints(preview: IIncomingPreview): string {
	return preview.incoming.map(checkpoint => `- "${checkpoint.title}" by ${checkpoint.authorName}`).join('\n');
}

/** The list of the person's changed files, for the prompt. */
function listMine(myChangedPaths: readonly string[]): string {
	return myChangedPaths.length > 0 ? myChangedPaths.join('\n') : '(none)';
}

/**
 * The most characters `renderIncomingForModel` may use for one request: the input limit, less the
 * room for the instructions and the lists of checkpoints and files.
 */
export function incomingDiffBudget(preview: IIncomingPreview, myChangedPaths: readonly string[]): number {
	return Math.max(0, MAX_INPUT_CHARS - PROMPT_ALLOWANCE_CHARS - listCheckpoints(preview).length - listMine(myChangedPaths).length);
}

/** The text of the facts the engine found, for the prompt. */
function describeFacts(preview: IIncomingPreview): string {
	const overlaps = preview.overlaps.length;
	return [
		overlaps > 0
			? `Facts found by comparing the files: in ${overlaps} places, the colleagues and the person changed the same lines.`
			: 'Facts found by comparing the files: the colleagues and the person changed no line in common.',
		preview.touchesLocalWork
			? 'Some of the colleagues\' changes are in files the person also changed.'
			: 'None of the colleagues\' changes are in files the person changed.',
	].join(' ');
}

const SYSTEM_PROMPT = [
	'Colleagues of a person added checkpoints of their work to the shared copy of a project. You summarize what the colleagues changed, for the person, before the person gets those changes.',
	'Answer with a JSON object of this form:',
	'{"summary": "...", "relation": "unrelated"}',
	`- "summary" is one to three sentences, at most ${MAX_INCOMING_SUMMARY_CHARS} characters, about what the colleagues changed and why it matters. Name the colleagues by the names given. Write in the third person, for example "Maya updated the dosing table."`,
	'- "relation" says how the colleagues\' changes relate to the person\'s own changes:',
	'  "overlapping" when the facts say that both changed the same lines, and only then.',
	'  "nearby" when the facts say that some of the colleagues\' changes are in files the person also changed, or when the changes are close to the person\'s work in purpose.',
	'  "unrelated" only when the facts say that none of the colleagues\' changes are in files the person changed.',
].join('\n');

/** The plain-language summary of colleagues' changes, checked against the engine's facts. */
export const summarizeIncomingJob: Job<ISummarizeIncomingInput, IIncomingSummary> = {
	name: 'summarize-incoming',
	weight: 'light',
	version: 1,

	buildPrompt(input) {
		const content = [
			'Checkpoints from the colleagues:',
			listCheckpoints(input.preview),
			'',
			'Files the person changed since their last checkpoint:',
			listMine(input.myChangedPaths),
			'',
			'What the colleagues changed:',
			input.incomingDiff,
		].join('\n');
		return {
			systemPrompt: SYSTEM_PROMPT,
			user: [
				'Summarize the colleagues\' changes.',
				describeFacts(input.preview),
				wrapUntrusted('the colleagues\' checkpoints, the names of the person\'s changed files, and the colleagues\' changes', content),
			].join('\n\n'),
		};
	},

	check(raw, input) {
		const summary = field(raw, 'summary');
		const relation = field(raw, 'relation');
		if (typeof summary !== 'string' || typeof relation !== 'string' || !RELATIONS.includes(relation as IncomingRelation)) {
			return undefined;
		}
		const trimmed = summary.trim();
		if (trimmed.length === 0 || trimmed.length > MAX_INCOMING_SUMMARY_CHARS) {
			return undefined;
		}
		// The relation must agree with the engine, which decides what overlaps.
		const overlapping = input.preview.overlaps.length > 0;
		if ((relation === 'overlapping') !== overlapping) {
			return undefined;
		}
		if (relation === 'unrelated' && input.preview.touchesLocalWork) {
			return undefined;
		}
		if (containsForbiddenWord(trimmed, [...input.preview.changedPaths, ...input.myChangedPaths])) {
			return undefined;
		}
		return { summary: trimmed, relation: relation as IncomingRelation };
	},
};
