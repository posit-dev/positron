/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { escapedLength, ErrorPromptSource, getErrorPrompt, PromptDocument, PromptL10n } from './errorPrompt';

/** Fills in `{n}` placeholders, as `vscode.l10n.t` does without a bundle. */
const english: PromptL10n = {
	t: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)])),
};

const savedNotebook: PromptDocument = { name: '/home/user/project/analysis.ipynb', isUntitled: false, isDirty: false };
const savedReport: PromptDocument = { name: '/home/user/project/report.qmd', isUntitled: false, isDirty: false };

describe('getErrorPrompt', () => {
	it('names the console session and the console input as it is now, and scopes Fix', () => {
		const source: ErrorPromptSource = { kind: 'console', sessionName: 'Python 3.12.1 (Venv: .venv)', languageId: 'python', code: 'x + 1' };

		expect(getErrorPrompt('fix', source, 'NameError: name \'x\' is not defined', english)).toMatchInlineSnapshot(`
			"Code run in the Positron console session "Python 3.12.1 (Venv: .venv)" raised an error. The code may not be saved in any file. Fix the error. Only edit project files if the cause is in one of them.

			Code (the console input as it is now):

			\`\`\`python
			x + 1
			\`\`\`

			Error:

			\`\`\`
			NameError: name 'x' is not defined
			\`\`\`"
		`);
	});

	it('names a notebook cell by its position from the top, with its current content', () => {
		const source: ErrorPromptSource = { kind: 'notebook', document: savedNotebook, cell: { index: 2, code: 'df.plot()', languageId: 'python' } };

		expect(getErrorPrompt('explain', source, 'KeyError: \'a\'', english)).toMatchInlineSnapshot(`
			"Cell 3 of /home/user/project/analysis.ipynb raised an error. Explain what caused the error and how to fix it, without making changes or editing any files.

			Code (the cell's current content):

			\`\`\`python
			df.plot()
			\`\`\`

			Error:

			\`\`\`
			KeyError: 'a'
			\`\`\`"
		`);
	});

	it('says when a saved notebook has unsaved changes', () => {
		const source: ErrorPromptSource = { kind: 'notebook', document: { ...savedNotebook, isDirty: true }, cell: { index: 0, code: 'x', languageId: 'python' } };

		expect(getErrorPrompt('fix', source, 'boom', english).split('\n')[0]).toBe(
			'Cell 1 of /home/user/project/analysis.ipynb raised an error. The file has unsaved changes in the editor. Fix the error.'
		);
	});

	it('names an untitled notebook as unsaved, and still sends the cell\'s code', () => {
		const source: ErrorPromptSource = { kind: 'notebook', document: { name: 'Untitled-1.ipynb', isUntitled: true, isDirty: true }, cell: { index: 0, code: 'x', languageId: 'python' } };

		expect(getErrorPrompt('fix', source, 'boom', english)).toMatchInlineSnapshot(`
			"Cell 1 of Untitled-1.ipynb, a notebook that isn't saved to a file, raised an error. Fix the error.

			Code (the cell's current content):

			\`\`\`python
			x
			\`\`\`

			Error:

			\`\`\`
			boom
			\`\`\`"
		`);
	});

	it('names the notebook without code when the cell is gone', () => {
		const source: ErrorPromptSource = { kind: 'notebook', document: savedNotebook };

		expect(getErrorPrompt('fix', source, 'boom', english)).toMatchInlineSnapshot(`
			"A cell in /home/user/project/analysis.ipynb raised an error. Fix the error.

			Error:

			\`\`\`
			boom
			\`\`\`"
		`);
	});

	it('names a Quarto chunk by its lines, with the chunk as run', () => {
		const source: ErrorPromptSource = { kind: 'quarto', document: savedReport, cell: { languageId: 'r', code: 'stop("boom")', startLine: 8, endLine: 9 } };

		expect(getErrorPrompt('fix', source, 'Error: boom', english)).toMatchInlineSnapshot(`
			"The r code chunk at lines 8-9 of /home/user/project/report.qmd raised an error. Fix the error.

			Code (the chunk as run):

			\`\`\`r
			stop("boom")
			\`\`\`

			Error:

			\`\`\`
			Error: boom
			\`\`\`"
		`);
	});

	it('names an untitled Quarto document as unsaved, and the document alone when the chunk is not found', () => {
		const untitled: PromptDocument = { name: 'Untitled-1.qmd', isUntitled: true, isDirty: true };

		expect([
			getErrorPrompt('fix', { kind: 'quarto', document: untitled, cell: { languageId: 'r', code: 'x', startLine: 2, endLine: 2 } }, 'boom', english).split('\n')[0],
			getErrorPrompt('fix', { kind: 'quarto', document: savedReport }, 'boom', english).split('\n')[0],
		]).toEqual([
			'The r code chunk at lines 2-2 of Untitled-1.qmd, a document that isn\'t saved to a file, raised an error. Fix the error.',
			'A code chunk in /home/user/project/report.qmd raised an error. Fix the error.',
		]);
	});

	it('fences blocks longer than any backtick run inside them', () => {
		const source: ErrorPromptSource = { kind: 'console', sessionName: 'R 4.4.1', languageId: 'r', code: 'cat("````")' };

		expect(getErrorPrompt('explain', source, 'boom', english)).toContain('`````r\ncat("````")\n`````');
	});

	it('is in the user\'s language, leaving the error, code, and paths as they are', () => {
		const pseudo: PromptL10n = { t: (message, ...args) => `<<${english.t(message, ...args)}>>` };
		const source: ErrorPromptSource = { kind: 'notebook', document: savedNotebook, cell: { index: 0, code: 'x', languageId: 'python' } };

		expect(getErrorPrompt('fix', source, 'boom', pseudo)).toMatchInlineSnapshot(`
			"<<Cell 1 of /home/user/project/analysis.ipynb raised an error.>> <<Fix the error.>>

			<<Code (the cell's current content):>>

			\`\`\`python
			x
			\`\`\`

			<<Error:>>

			\`\`\`
			boom
			\`\`\`"
		`);
	});

	describe('long code and errors', () => {
		/**
		 * The code and error blocks' text, measured as Windows escapes it, and
		 * the whole prompt's, which must fit on a Windows command line.
		 */
		function lengths(prompt: string) {
			const blocks = [...prompt.matchAll(/```\w*\n(?<text>[^`]*)\n```/g)].map(match => match.groups?.text ?? '');
			return {
				details: blocks.reduce((total, block) => total + escapedLength(block), 0),
				fitsCommandLine: escapedLength(prompt) < 32_767,
			};
		}

		it('shortens a long error in the middle, saying how much was omitted', () => {
			const error = `start\n${'"\\'.repeat(20_000)}\nend`;
			const prompt = getErrorPrompt('fix', { kind: 'notebook', document: savedNotebook }, error, english);

			expect(prompt).toContain('Error (shortened):\n\n```\nstart\n');
			expect(prompt).toMatch(/\n\[\.\.\. \d+ characters omitted \.\.\.\]\n/);
			expect(prompt).toContain('\nend\n```');
			expect(lengths(prompt)).toEqual({ details: expect.toSatisfy((length: number) => length <= 30_000), fitsCommandLine: true });
		});

		it('shortens the code before the error, keeping at least 2,000 characters of it', () => {
			const source: ErrorPromptSource = { kind: 'console', sessionName: 'R 4.4.1', languageId: 'r', code: 'c'.repeat(40_000) };
			const prompt = getErrorPrompt('fix', source, 'e'.repeat(40_000), english);
			const code = prompt.match(/```r\n(?<code>[^`]*)\n```/)?.groups?.code ?? '';

			expect(prompt).toContain('Code (the console input as it is now, shortened):');
			expect(prompt).toContain('Error (shortened):');
			expect(code.replace(/\n\[.*\]\n/, '').length).toBeGreaterThanOrEqual(1_900);
			expect(lengths(prompt)).toEqual({ details: expect.toSatisfy((length: number) => length <= 30_000), fitsCommandLine: true });
		});

		it('keeps both whole when they fit', () => {
			const source: ErrorPromptSource = { kind: 'console', sessionName: 'R 4.4.1', languageId: 'r', code: 'c'.repeat(10_000) };
			const prompt = getErrorPrompt('fix', source, 'e'.repeat(19_000), english);

			expect(prompt).not.toContain('shortened');
		});
	});
});
