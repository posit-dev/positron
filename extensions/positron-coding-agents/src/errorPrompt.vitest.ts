/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as positron from 'positron';
import type { Uri } from 'vscode';
import { getErrorPrompt } from './errorPrompt';

/** A stand-in URI; prompts only see it through getPath. */
const notebookUri = { path: '/work/analysis.ipynb' } as Uri;

/** Resolve a URI to its path, standing in for workspace-relative paths. */
const getPath = (uri: Uri) => uri.path.slice('/work/'.length);

/** The prompt's first paragraph: where the error came from and what to do. */
const getLead = (prompt: string) => prompt.split('\n\n', 1)[0];

/** The prompt after its first paragraph: the code and error blocks. */
const getDetails = (prompt: string) => prompt.slice(getLead(prompt).length + 2);

const consoleContext: Omit<positron.ai.ErrorActionContext, 'chat'> = {
	error: 'NameError: name \'x\' is not defined',
	location: {
		kind: 'console',
		sessionId: 'python-1234',
		sessionName: 'Python 3.12.1 (Venv: .venv)',
		languageId: 'python',
		code: 'print(x)',
	},
};

describe('getErrorPrompt', () => {
	it('names the console session and includes the code for a console error', () => {
		expect(getErrorPrompt('fix', consoleContext, getPath)).toBe([
			'Code run in the Positron console session "Python 3.12.1 (Venv: .venv)" raised an error. The code may not be saved in any file. Fix the error. Only edit project files if the cause is in one of them.',
			'',
			'Code:',
			'',
			'```python',
			'print(x)',
			'```',
			'',
			'Error:',
			'',
			'```',
			'NameError: name \'x\' is not defined',
			'```',
		].join('\n'));
	});

	it('asks for an explanation without changes for Explain', () => {
		expect(getLead(getErrorPrompt('explain', consoleContext, getPath))).toBe(
			'Code run in the Positron console session "Python 3.12.1 (Venv: .venv)" raised an error. The code may not be saved in any file. Explain what caused the error and how to fix it, without making changes or editing any files.'
		);
	});

	it('points the agent at the MCP server for the session when it is configured', () => {
		expect(getLead(getErrorPrompt('fix', consoleContext, getPath, 'positron'))).toBe(
			'Code run in the Positron console session "Python 3.12.1 (Venv: .venv)" raised an error. The code may not be saved in any file. Fix the error. Only edit project files if the cause is in one of them. ' +
			'Positron\'s MCP server (`positron`) can inspect this session (session_id: python-1234). Its tools may take a moment to connect; don\'t conclude you lack access.'
		);
	});

	it('points the agent at the notebook\'s kernel session for inspection only', () => {
		expect(getLead(getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'notebook', uri: notebookUri, cellIndex: 2, sessionId: 'python-5678' },
		}, getPath, 'positron'))).toBe(
			'Cell 3 of analysis.ipynb raised an error. Fix the error. ' +
			'Positron\'s MCP server (`positron`) can inspect the notebook\'s kernel session (session_id: python-5678). Its tools may take a moment to connect; don\'t conclude you lack access. ' +
			'Use it to inspect the kernel\'s state, not to run code that changes it.'
		);
	});

	it('points the agent at the Quarto document\'s kernel session', () => {
		expect(getLead(getErrorPrompt('explain', {
			error: 'boom',
			location: { kind: 'quarto', uri: { path: '/work/report.qmd' } as Uri, languageId: 'r', startLine: 10, endLine: 12, code: 'log(-1)', sessionId: 'r-9012' },
		}, getPath, 'positron'))).toContain('can inspect the document\'s kernel session (session_id: r-9012).');
	});

	it('does not mention the MCP server for a notebook without a session', () => {
		expect(getLead(getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'notebook', uri: notebookUri, cellIndex: 2 },
		}, getPath, 'positron'))).toBe('Cell 3 of analysis.ipynb raised an error. Fix the error.');
	});

	it('omits the code block when the console code is unknown', () => {
		const location = { ...consoleContext.location as positron.ai.ConsoleErrorLocation, code: undefined };
		expect(getDetails(getErrorPrompt('fix', { ...consoleContext, location }, getPath))).toBe(
			'Error:\n\n```\nNameError: name \'x\' is not defined\n```'
		);
	});

	it('names the cell for a saved notebook error, without its code', () => {
		expect(getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'notebook', uri: notebookUri, cellIndex: 2, code: 'print(x)', languageId: 'python' },
		}, getPath)).toBe('Cell 3 of analysis.ipynb raised an error. Fix the error.\n\nError:\n\n```\nboom\n```');
	});

	it('includes the cell\'s code for a notebook that is not saved to a file', () => {
		expect(getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'notebook', uri: { path: '/work/Untitled-1.ipynb' } as Uri, cellIndex: 0, code: 'print(x)', languageId: 'python' },
		}, getPath, undefined, 'untitled')).toBe([
			'Cell 1 of Untitled-1.ipynb raised an error. The notebook is not saved to a file, so the cell\'s code is below. Fix the error.',
			'',
			'Code:',
			'',
			'```python',
			'print(x)',
			'```',
			'',
			'Error:',
			'',
			'```',
			'boom',
			'```',
		].join('\n'));
	});

	it('includes the cell\'s code for a notebook with unsaved changes', () => {
		expect(getLead(getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'notebook', uri: notebookUri, cellIndex: 2, code: 'print(x)', languageId: 'python' },
		}, getPath, undefined, 'dirty'))).toBe(
			'Cell 3 of analysis.ipynb raised an error. The notebook has unsaved changes, so the cell\'s code is below. Fix the error.'
		);
	});

	it('includes the chunk\'s code for a Quarto document that is not saved to a file', () => {
		const prompt = getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'quarto', uri: { path: '/work/Untitled-1.qmd' } as Uri, languageId: 'r', startLine: 3, endLine: 3, code: 'log(-1)' },
		}, getPath, undefined, 'untitled');
		expect(getLead(prompt)).toBe(
			'The r code chunk at lines 3-3 of Untitled-1.qmd raised an error. The document is not saved to a file, so the chunk\'s code is below. Fix the error.'
		);
		expect(getDetails(prompt)).toBe('Code:\n\n```r\nlog(-1)\n```\n\nError:\n\n```\nboom\n```');
	});

	it('names only the notebook when the cell no longer exists', () => {
		expect(getLead(getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'notebook', uri: notebookUri },
		}, getPath))).toBe('A cell in analysis.ipynb raised an error. Fix the error.');
	});

	it('names the chunk for a Quarto error', () => {
		expect(getLead(getErrorPrompt('explain', {
			error: 'boom',
			location: { kind: 'quarto', uri: { path: '/work/report.qmd' } as Uri, languageId: 'r', startLine: 10, endLine: 12, code: 'log(-1)' },
		}, getPath))).toBe(
			'The r code chunk at lines 10-12 of report.qmd raised an error. Explain what caused the error and how to fix it, without making changes or editing any files.'
		);
	});

	it('sends only the task when the error has no location or output', () => {
		expect(getErrorPrompt('fix', { error: '' }, getPath)).toBe('Fix the error.');
	});

	it('lengthens the fence past any backticks in the code or error', () => {
		const location = { ...consoleContext.location as positron.ai.ConsoleErrorLocation, code: 'x = "```"' };
		expect(getDetails(getErrorPrompt('fix', { error: 'code: ````x````', location }, getPath))).toBe(
			'Code:\n\n````python\nx = "```"\n````\n\nError:\n\n`````\ncode: ````x````\n`````'
		);
	});

	it('cuts long code before the error, keeping the start and end of each', () => {
		const code = 'a'.repeat(20_000) + 'b'.repeat(20_000);
		const error = 'Traceback\n' + 'x'.repeat(40_000) + '\nValueError: boom';
		const location = { ...consoleContext.location as positron.ai.ConsoleErrorLocation, code };
		const details = getDetails(getErrorPrompt('fix', { error, location }, getPath));
		expect(details.length).toBeLessThan(31_000);
		expect(details).toMatch(/^Code:\n\n```python\na+\n\[\.\.\. 38000 characters omitted \.\.\.\]\nb+\n```/);
		expect(details).toContain('Error:\n\n```\nTraceback\n');
		expect(details).toMatch(/ValueError: boom\n```$/);
	});

	it('keeps code and error that fit as they are', () => {
		const location = { ...consoleContext.location as positron.ai.ConsoleErrorLocation, code: 'x = 1\n'.repeat(2000) };
		expect(getErrorPrompt('fix', { ...consoleContext, location }, getPath)).not.toContain('omitted');
	});
});
