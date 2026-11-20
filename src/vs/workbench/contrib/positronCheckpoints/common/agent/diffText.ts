/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChangedFile, IChangeSet } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';

// The text of a change set as the model reads it, as a list of files or as a list of parts. The
// text of a file or a part is in full, or, when the whole text is too long, only the first line of
// each part with its line counts. A data file or a file over the size limit shows no contents.

/** How much of one file the text shows. */
const enum Detail {
	/** Every part in full. */
	Full,
	/** The first line of each part and its line counts. */
	Headers,
	/** The "File:" line only. */
	Name,
}

/** What the file is, in plain words, for its "File:" line. */
function describeStatus(file: IChangedFile): string {
	switch (file.status) {
		case 'added': return 'new';
		case 'deleted': return 'removed';
		case 'renamed': return `renamed from ${file.oldPath ?? 'an earlier name'}`;
		case 'modified': return 'changed';
	}
}

/** True when the file is sent as its name and size only. */
function nameAndSizeOnly(file: IChangedFile): boolean {
	return file.binary || file.tooLarge;
}

/** The text of one file at the given detail. */
function renderFile(file: IChangedFile, detail: Detail): string {
	const status = describeStatus(file);
	if (nameAndSizeOnly(file)) {
		return `File: ${file.path} (${status}, data file, ${file.sizeBytes} bytes, contents not shown)`;
	}
	const added = file.hunks.reduce((total, hunk) => total + hunk.addedLines, 0);
	const removed = file.hunks.reduce((total, hunk) => total + hunk.removedLines, 0);
	switch (detail) {
		case Detail.Full:
			return [`File: ${file.path} (${status})`, ...file.hunks.map(hunk => hunk.patch.replace(/\n$/, ''))].join('\n');
		case Detail.Headers:
			return [
				`File: ${file.path} (${status}, contents shortened)`,
				...file.hunks.map(hunk => `${hunk.header} (+${hunk.addedLines} -${hunk.removedLines} lines)`),
			].join('\n');
		case Detail.Name:
			return `File: ${file.path} (${status}, ${file.hunks.length} parts, +${added} -${removed} lines, contents not shown)`;
	}
}

/** The length of `texts` joined with one newline between them. */
function joinedLength(texts: readonly string[]): number {
	return texts.reduce((total, text) => total + text.length, 0) + Math.max(texts.length - 1, 0);
}

/**
 * Shortens items largest first until their joined text fits `maxChars`. `forms[i]` lists the
 * texts of item i from the full one to the shortest. Every item is shortened one step before any
 * item is shortened a second step, and a shorter form replaces a text only when it is shorter.
 * The result can still be longer than `maxChars` when even the shortest forms do not fit.
 */
function shortenLargestFirst(forms: readonly (readonly string[])[], maxChars: number): string[] {
	const texts = forms.map(itemForms => itemForms[0]);
	// Largest first, by the length of the full text.
	const bySize = texts.map((_, index) => index).sort((a, b) => texts[b].length - texts[a].length);
	const steps = Math.max(0, ...forms.map(itemForms => itemForms.length - 1));
	for (let step = 1; step <= steps; step++) {
		for (const index of bySize) {
			if (joinedLength(texts) <= maxChars) {
				return texts;
			}
			const shorter = forms[index][step];
			// For a file with small parts, the shorter form can be the longer text.
			if (shorter !== undefined && shorter.length < texts[index].length) {
				texts[index] = shorter;
			}
		}
	}
	return texts;
}

/**
 * The changes as text for a model request, at most `maxChars` characters long. Data files and
 * files over the size limit appear as name and size only. When the full text is longer than
 * `maxChars`, files are shortened largest first to the first line of each part with its line
 * counts, then largest first to their "File:" line. When even that is too long, the last files
 * are left out and a final line says how many.
 */
export function renderChangesForModel(changes: IChangeSet, maxChars: number): string {
	const texts = shortenLargestFirst(changes.files.map(file => [Detail.Full, Detail.Headers, Detail.Name].map(detail => renderFile(file, detail))), maxChars);
	if (joinedLength(texts) <= maxChars) {
		return texts.join('\n');
	}

	// Keeps the first files that fit, with room for the line that counts the others.
	const kept: string[] = [];
	for (let index = 0; index < texts.length; index++) {
		const omitted = `(${texts.length - index - 1} more files are not shown)`;
		if (joinedLength([...kept, texts[index], omitted]) > maxChars) {
			const line = `(${texts.length - index} more files are not shown)`;
			return [...kept, line].join('\n').slice(0, maxChars);
		}
		kept.push(texts[index]);
	}
	return kept.join('\n');
}

/**
 * The changes as a list of parts for a model request, at most `maxChars` characters long. Each
 * part of a text file is a "Part <id> of <path>" line followed by the part's text. A file without
 * parts (a data file, a file over the size limit, or a change with no lines) is one "Whole file"
 * line; the parts of a data file or a file over the size limit show no text. When the full text
 * is longer than `maxChars`, parts are shortened largest first to their first line and line
 * counts.
 *
 * @returns The text, or undefined when even the shortened list does not fit, since every part
 * must be listed for the model to place it.
 */
export function renderHunksForModel(changes: IChangeSet, maxChars: number): string | undefined {
	const forms = changes.files.flatMap(file => {
		const status = describeStatus(file);
		if (file.hunks.length === 0) {
			const kind = nameAndSizeOnly(file) ? `data file, ${file.sizeBytes} bytes, contents not shown` : 'no lines to show';
			return [[`Whole file ${file.path} (${status}, ${kind})`]];
		}
		return file.hunks.map(hunk => {
			const short = `Part ${hunk.id} of ${file.path} (${status}): ${hunk.header} (+${hunk.addedLines} -${hunk.removedLines} lines, contents not shown)`;
			return nameAndSizeOnly(file) ? [short] : [`Part ${hunk.id} of ${file.path} (${status})\n${hunk.patch.replace(/\n$/, '')}`, short];
		});
	});
	const texts = shortenLargestFirst(forms, maxChars);
	return joinedLength(texts) <= maxChars ? texts.join('\n') : undefined;
}
