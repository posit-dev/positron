/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import type * as positron from 'positron';
import * as vscode from 'vscode';
import { escapedLength, getErrorPrompt } from '../errorPrompt';

/** A saved notebook that isn't open, so it's named by its path and has no unsaved changes. */
const notebookUri = vscode.Uri.file(path.join(os.tmpdir(), 'analysis.ipynb'));

/** A saved Quarto document that isn't open. */
const reportUri = vscode.Uri.file(path.join(os.tmpdir(), 'report.qmd'));

function consoleContext(code: string, error: string): positron.ai.ConsoleErrorActionContext {
	return { kind: 'console', error, sessionId: 'session', sessionName: 'R 4.4.1', languageId: 'r', code };
}

function notebookContext(uri: vscode.Uri, error: string, cell?: positron.ai.NotebookErroredCell): positron.ai.NotebookErrorActionContext {
	return { kind: 'notebook', error, uri, cell };
}

function quartoContext(uri: vscode.Uri, error: string, cell?: positron.ai.QuartoErroredCell): positron.ai.QuartoErrorActionContext {
	return { kind: 'quarto', error, uri, cell };
}

function firstLine(prompt: string): string {
	return prompt.split('\n')[0];
}

suite('getErrorPrompt', () => {
	test('names the console session and the console input as it is now, and scopes Fix', () => {
		const context: positron.ai.ConsoleErrorActionContext = {
			kind: 'console',
			error: 'NameError: name \'x\' is not defined',
			sessionId: 'session',
			sessionName: 'Python 3.12.1 (Venv: .venv)',
			languageId: 'python',
			code: 'x + 1',
		};

		assert.strictEqual(getErrorPrompt('fix', context), [
			'Code run in the Positron console session "Python 3.12.1 (Venv: .venv)" raised an error. The code may not be saved in any file. Fix the error. Only edit project files if the cause is in one of them.',
			'',
			'Code (the console input as it is now):',
			'',
			'```python',
			'x + 1',
			'```',
			'',
			'Error:',
			'',
			'```',
			'NameError: name \'x\' is not defined',
			'```',
		].join('\n'));
	});

	test('names a notebook cell by its position from the top, with its current content', () => {
		const context = notebookContext(notebookUri, 'KeyError: \'a\'', { index: 2, code: 'df.plot()', languageId: 'python' });

		assert.strictEqual(getErrorPrompt('explain', context), [
			`Cell 3 of ${notebookUri.fsPath} raised an error. Explain what caused the error and how to fix it, without making changes or editing any files.`,
			'',
			'Code (the cell\'s current content):',
			'',
			'```python',
			'df.plot()',
			'```',
			'',
			'Error:',
			'',
			'```',
			'KeyError: \'a\'',
			'```',
		].join('\n'));
	});

	test('names an untitled notebook as unsaved, and still sends the cell\'s code', () => {
		const context = notebookContext(vscode.Uri.parse('untitled:Untitled-1.ipynb'), 'boom', { index: 0, code: 'x', languageId: 'python' });

		assert.strictEqual(getErrorPrompt('fix', context), [
			'Cell 1 of Untitled-1.ipynb, a notebook that isn\'t saved to a file, raised an error. Fix the error.',
			'',
			'Code (the cell\'s current content):',
			'',
			'```python',
			'x',
			'```',
			'',
			'Error:',
			'',
			'```',
			'boom',
			'```',
		].join('\n'));
	});

	test('names the notebook without code when the cell is gone', () => {
		assert.strictEqual(getErrorPrompt('fix', notebookContext(notebookUri, 'boom')), [
			`A cell in ${notebookUri.fsPath} raised an error. Fix the error.`,
			'',
			'Error:',
			'',
			'```',
			'boom',
			'```',
		].join('\n'));
	});

	test('names a Quarto chunk by its lines, with the chunk as run', () => {
		const context = quartoContext(reportUri, 'Error: boom', { languageId: 'r', code: 'stop("boom")', startLine: 8, endLine: 9 });

		assert.strictEqual(getErrorPrompt('fix', context), [
			`The r code chunk at lines 8-9 of ${reportUri.fsPath} raised an error. Fix the error.`,
			'',
			'Code (the chunk as run):',
			'',
			'```r',
			'stop("boom")',
			'```',
			'',
			'Error:',
			'',
			'```',
			'Error: boom',
			'```',
		].join('\n'));
	});

	test('names an untitled Quarto document as unsaved, and the document alone when the chunk is not found', () => {
		const cell = { languageId: 'r', code: 'x', startLine: 2, endLine: 2 };

		assert.deepStrictEqual([
			firstLine(getErrorPrompt('fix', quartoContext(vscode.Uri.parse('untitled:Untitled-1.qmd'), 'boom', cell))),
			firstLine(getErrorPrompt('fix', quartoContext(reportUri, 'boom'))),
		], [
			'The r code chunk at lines 2-2 of Untitled-1.qmd, a document that isn\'t saved to a file, raised an error. Fix the error.',
			`A code chunk in ${reportUri.fsPath} raised an error. Fix the error.`,
		]);
	});

	test('says when a saved document has unsaved changes', async () => {
		const uri = vscode.Uri.file(path.join(os.tmpdir(), `positron-claude-code-${Date.now()}.qmd`));
		await vscode.workspace.fs.writeFile(uri, Buffer.from('```{r}\nx\n```\n'));
		try {
			await vscode.window.showTextDocument(uri);
			const edit = new vscode.WorkspaceEdit();
			edit.insert(uri, new vscode.Position(0, 0), '# Draft\n');
			await vscode.workspace.applyEdit(edit);

			const cell = { languageId: 'r', code: 'x', startLine: 3, endLine: 3 };
			assert.strictEqual(
				firstLine(getErrorPrompt('fix', quartoContext(uri, 'boom', cell))),
				`The r code chunk at lines 3-3 of ${uri.fsPath} raised an error. The file has unsaved changes in the editor. Fix the error.`,
			);
		} finally {
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			await vscode.workspace.fs.delete(uri);
		}
	});

	test('fences blocks longer than any backtick run inside them', () => {
		const prompt = getErrorPrompt('explain', consoleContext('cat("````")', 'boom'));

		assert.ok(prompt.includes('`````r\ncat("````")\n`````'));
	});

	suite('long code and errors', () => {
		/**
		 * The code and error blocks' text, measured as Windows escapes it, and
		 * whether the whole prompt fits on a Windows command line.
		 */
		function lengths(prompt: string) {
			const blocks = [...prompt.matchAll(/```\w*\n(?<text>[^`]*)\n```/g)].map(match => match.groups?.text ?? '');
			return {
				details: blocks.reduce((total, block) => total + escapedLength(block), 0),
				fitsCommandLine: escapedLength(prompt) < 32_767,
			};
		}

		test('shortens a long error in the middle, saying how much was omitted', () => {
			const error = `start\n${'"\\'.repeat(20_000)}\nend`;
			const prompt = getErrorPrompt('fix', notebookContext(notebookUri, error));
			const { details, fitsCommandLine } = lengths(prompt);

			assert.ok(prompt.includes('Error (shortened):\n\n```\nstart\n'));
			assert.match(prompt, /\n\[\.\.\. \d+ characters omitted \.\.\.\]\n/);
			assert.ok(prompt.includes('\nend\n```'));
			assert.ok(details <= 30_000 && fitsCommandLine);
		});

		test('shortens the code before the error, keeping at least 2,000 characters of it', () => {
			const prompt = getErrorPrompt('fix', consoleContext('c'.repeat(40_000), 'e'.repeat(40_000)));
			const code = prompt.match(/```r\n(?<code>[^`]*)\n```/)?.groups?.code ?? '';
			const { details, fitsCommandLine } = lengths(prompt);

			assert.ok(prompt.includes('Code (the console input as it is now, shortened):'));
			assert.ok(prompt.includes('Error (shortened):'));
			assert.ok(code.replace(/\n\[.*\]\n/, '').length >= 1_900);
			assert.ok(details <= 30_000 && fitsCommandLine);
		});

		test('keeps both whole when they fit', () => {
			const prompt = getErrorPrompt('fix', consoleContext('c'.repeat(10_000), 'e'.repeat(19_000)));

			assert.ok(!prompt.includes('shortened'));
		});
	});
});
