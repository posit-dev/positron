/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Free of `vscode` imports so it can be unit tested. Its caller resolves
// documents and passes in `vscode.l10n`.

/**
 * Longest code and error text, together, in a prompt, measured after the
 * escaping Windows needs. A terminal prompt is passed on the command line,
 * which Windows caps at 32,767 characters.
 */
const MAX_DETAILS_LENGTH = 30_000;

/** Code kept when an error alone would fill the prompt. */
const MIN_CODE_LENGTH = 2_000;

/** An action the user can take on an error. */
export type ErrorPromptAction = 'fix' | 'explain';

/** Localizes the prompt's text; `vscode.l10n` outside of tests. */
export interface PromptL10n {
	t(message: string, ...args: Array<string | number | boolean>): string;
}

/** A notebook or Quarto document, as the prompt names it. */
export interface PromptDocument {
	/** The document's absolute path, or its name when it's untitled. */
	readonly name: string;
	/** Whether the document has never been saved to a file. */
	readonly isUntitled: boolean;
	/** Whether the document has changes the editor hasn't saved. */
	readonly isDirty: boolean;
}

/** Where an error came from, with the code that raised it. */
export type ErrorPromptSource =
	| {
		readonly kind: 'console';
		/** Name of the console's session, e.g. "Python 3.12.1 (Venv: .venv)". */
		readonly sessionName: string;
		readonly languageId: string;
		/** The console's input for the error, as it is now. */
		readonly code?: string;
	}
	| {
		readonly kind: 'notebook';
		readonly document: PromptDocument;
		/** The cell, as it is now. Undefined when it's no longer in the notebook. */
		readonly cell?: {
			/** 0-based index among all of the notebook's cells, markdown included. */
			readonly index: number;
			readonly code: string;
			readonly languageId: string;
		};
	}
	| {
		readonly kind: 'quarto';
		readonly document: PromptDocument;
		/** The chunk, as it was run. Undefined when it can't be found. */
		readonly cell?: {
			readonly languageId: string;
			readonly code: string;
			readonly startLine: number;
			readonly endLine: number;
		};
	};

/**
 * Build the prompt for a Fix or Explain action, for an agent that can't see
 * Positron: where the error came from and what to do, then the code, then the
 * error. It's in the user's language, since it's shown as their message and
 * the agent answers in the language it's asked in; the error, code, and paths
 * are left as they are.
 */
export function getErrorPrompt(action: ErrorPromptAction, source: ErrorPromptSource, error: string, l10n: PromptL10n): string {
	const fullCode = source.kind === 'console' ? source.code : source.cell?.code;
	const languageId = source.kind === 'console' ? source.languageId : source.cell?.languageId;

	// The error is kept in preference to the code: the agent can more likely
	// find the code elsewhere (e.g. in the file) than the error.
	const code = fullCode
		? truncateMiddle(fullCode, Math.max(MIN_CODE_LENGTH, MAX_DETAILS_LENGTH - escapedLength(error)), l10n)
		: undefined;
	const shortenedError = truncateMiddle(error, MAX_DETAILS_LENGTH - (code ? escapedLength(code.text) : 0), l10n);

	const blocks = [getLead(action, source, l10n)];
	if (code) {
		blocks.push(getCodeLabel(source.kind, code.isShortened, l10n), fence(code.text, languageId));
	}
	blocks.push(
		shortenedError.isShortened ? l10n.t('Error (shortened):') : l10n.t('Error:'),
		fence(shortenedError.text),
	);
	return blocks.join('\n\n');
}

/** Where the error came from and what to do about it. */
function getLead(action: ErrorPromptAction, source: ErrorPromptSource, l10n: PromptL10n): string {
	const sentences: string[] = [];
	switch (source.kind) {
		case 'console':
			// Without this, the agent has nothing to open and guesses at a file
			// the error might have come from.
			sentences.push(l10n.t('Code run in the Positron console session "{0}" raised an error. The code may not be saved in any file.', source.sessionName));
			break;
		case 'notebook': {
			const { document, cell } = source;
			// The position counts every cell from the top, as the ipynb does,
			// not the execution count.
			if (document.isUntitled) {
				sentences.push(cell
					? l10n.t('Cell {0} of {1}, a notebook that isn\'t saved to a file, raised an error.', cell.index + 1, document.name)
					: l10n.t('A cell in {0}, a notebook that isn\'t saved to a file, raised an error.', document.name));
			} else {
				sentences.push(cell
					? l10n.t('Cell {0} of {1} raised an error.', cell.index + 1, document.name)
					: l10n.t('A cell in {0} raised an error.', document.name));
			}
			break;
		}
		case 'quarto': {
			const { document, cell } = source;
			if (document.isUntitled) {
				sentences.push(cell
					? l10n.t('The {0} code chunk at lines {1}-{2} of {3}, a document that isn\'t saved to a file, raised an error.', cell.languageId, cell.startLine, cell.endLine, document.name)
					: l10n.t('A code chunk in {0}, a document that isn\'t saved to a file, raised an error.', document.name));
			} else {
				sentences.push(cell
					? l10n.t('The {0} code chunk at lines {1}-{2} of {3} raised an error.', cell.languageId, cell.startLine, cell.endLine, document.name)
					: l10n.t('A code chunk in {0} raised an error.', document.name));
			}
			break;
		}
	}
	// An agent edits the file on disk, which would collide with edits the
	// editor still holds.
	if (source.kind !== 'console' && !source.document.isUntitled && source.document.isDirty) {
		sentences.push(l10n.t('The file has unsaved changes in the editor.'));
	}
	if (action === 'fix') {
		sentences.push(l10n.t('Fix the error.'));
		// The console's code is not in the project, so a fix there usually
		// means corrected code to run rather than an edit.
		if (source.kind === 'console') {
			sentences.push(l10n.t('Only edit project files if the cause is in one of them.'));
		}
	} else {
		sentences.push(l10n.t('Explain what caused the error and how to fix it, without making changes or editing any files.'));
	}
	return sentences.join(' ');
}

/**
 * Describe the code as what each surface sends: console and notebook code is
 * read when the action is taken, so it may have been edited since the error;
 * Quarto code is captured when the chunk runs.
 */
function getCodeLabel(kind: ErrorPromptSource['kind'], isShortened: boolean, l10n: PromptL10n): string {
	switch (kind) {
		case 'console':
			return isShortened
				? l10n.t('Code (the console input as it is now, shortened):')
				: l10n.t('Code (the console input as it is now):');
		case 'notebook':
			return isShortened
				? l10n.t('Code (the cell\'s current content, shortened):')
				: l10n.t('Code (the cell\'s current content):');
		case 'quarto':
			return isShortened
				? l10n.t('Code (the chunk as run, shortened):')
				: l10n.t('Code (the chunk as run):');
	}
}

/**
 * The length of text once escaped as a Windows command-line argument, where a
 * quote or a backslash can take two characters. An upper bound.
 */
export function escapedLength(text: string): number {
	let length = text.length;
	for (const character of text) {
		if (character === '"' || character === '\\') {
			length++;
		}
	}
	return length;
}

/**
 * Cut text whose {@link escapedLength} is over `maxLength` in the middle,
 * keeping its start and end, and mark the cut with a line saying how much was
 * omitted.
 */
export function truncateMiddle(text: string, maxLength: number, l10n: PromptL10n): { readonly text: string; readonly isShortened: boolean } {
	if (escapedLength(text) <= maxLength) {
		return { text, isShortened: false };
	}
	// The marker's count is at most the text's length, so this one is at
	// least as long as the final marker.
	const marker = (omitted: number) => `\n${l10n.t('[... {0} characters omitted ...]', omitted)}\n`;
	const budget = Math.max(0, maxLength - escapedLength(marker(text.length)));

	let headEnd = 0;
	let headLength = 0;
	while (headEnd < text.length && headLength + escapedLength(text[headEnd]) <= budget / 2) {
		headLength += escapedLength(text[headEnd++]);
	}
	let tailStart = text.length;
	let tailLength = 0;
	while (tailStart > headEnd && headLength + tailLength + escapedLength(text[tailStart - 1]) <= budget) {
		tailLength += escapedLength(text[--tailStart]);
	}
	// Don't split a surrogate pair.
	if (headEnd > 0 && isHighSurrogate(text.charCodeAt(headEnd - 1))) {
		headEnd--;
	}
	if (tailStart < text.length && isLowSurrogate(text.charCodeAt(tailStart))) {
		tailStart++;
	}
	const omitted = tailStart - headEnd;
	return { text: text.slice(0, headEnd) + marker(omitted) + text.slice(tailStart), isShortened: true };
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xD800 && code <= 0xDBFF;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xDC00 && code <= 0xDFFF;
}

/**
 * Fence a block, using a fence longer than any backtick run in the text so
 * the block can't end early.
 */
function fence(text: string, languageId = ''): string {
	const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
	const marker = '`'.repeat(Math.max(3, longestRun + 1));
	return `${marker}${languageId}\n${text}\n${marker}`;
}
