/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as positron from 'positron';
import type { Uri } from 'vscode';
import { canInlineBody, formatFilePrompt, formatInlinePrompt, getClaudeCodeSurface, getErrorPrompt } from './claudeCodeLaunch';

/** A stand-in URI; prompts only see it through getPath. */
const notebookUri = { path: '/work/analysis.ipynb' } as Uri;

/** Resolve a URI to its path, standing in for workspace-relative paths. */
const getPath = (uri: Uri) => uri.path.slice('/work/'.length);

const consoleContext: positron.ai.ErrorActionContext = {
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
		expect(formatInlinePrompt(getErrorPrompt('fix', consoleContext, getPath))).toBe([
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
		expect(getErrorPrompt('explain', consoleContext, getPath).lead).toBe(
			'Code run in the Positron console session "Python 3.12.1 (Venv: .venv)" raised an error. The code may not be saved in any file. Explain what caused the error and how to fix it, without making changes or editing any files.'
		);
	});

	it('points Claude at the MCP server for the session when it is configured', () => {
		expect(getErrorPrompt('fix', consoleContext, getPath, 'positron').lead).toBe(
			'Code run in the Positron console session "Python 3.12.1 (Venv: .venv)" raised an error. The code may not be saved in any file. Fix the error. Only edit project files if the cause is in one of them. ' +
			'Positron\'s MCP server (`positron`) can inspect this session (session_id: python-1234). If no `mcp__positron__*` tools are listed yet, the server may still be connecting: use ToolSearch to find tools whose names start with `mcp__positron__`, which waits for it. Don\'t conclude you lack access.'
		);
	});

	it('points Claude at the notebook\'s kernel session for inspection only', () => {
		expect(getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'notebook', uri: notebookUri, cellIndex: 2, sessionId: 'python-5678' },
		}, getPath, 'positron').lead).toBe(
			'Cell 3 of analysis.ipynb raised an error. Fix the error. ' +
			'Positron\'s MCP server (`positron`) can inspect the notebook\'s kernel session (session_id: python-5678). If no `mcp__positron__*` tools are listed yet, the server may still be connecting: use ToolSearch to find tools whose names start with `mcp__positron__`, which waits for it. Don\'t conclude you lack access. ' +
			'Use it to inspect the kernel\'s state, not to run code that changes it.'
		);
	});

	it('points Claude at the Quarto document\'s kernel session', () => {
		expect(getErrorPrompt('explain', {
			error: 'boom',
			location: { kind: 'quarto', uri: { path: '/work/report.qmd' } as Uri, languageId: 'r', startLine: 10, endLine: 12, sessionId: 'r-9012' },
		}, getPath, 'positron').lead).toContain('can inspect the document\'s kernel session (session_id: r-9012).');
	});

	it('does not mention the MCP server for a notebook without a session', () => {
		expect(getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'notebook', uri: notebookUri, cellIndex: 2 },
		}, getPath, 'positron').lead).toBe('Cell 3 of analysis.ipynb raised an error. Fix the error.');
	});

	it('omits the code block when the console code is unknown', () => {
		const location = { ...consoleContext.location as positron.ai.ConsoleErrorLocation, code: undefined };
		expect(getErrorPrompt('fix', { ...consoleContext, location }, getPath).body).toBe(
			'Error:\n\n```\nNameError: name \'x\' is not defined\n```'
		);
	});

	it('names the cell for a notebook error, without its code', () => {
		expect(getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'notebook', uri: notebookUri, cellIndex: 2 },
		}, getPath)).toEqual({
			lead: 'Cell 3 of analysis.ipynb raised an error. Fix the error.',
			body: 'Error:\n\n```\nboom\n```',
		});
	});

	it('names only the notebook when the cell no longer exists', () => {
		expect(getErrorPrompt('fix', {
			error: 'boom',
			location: { kind: 'notebook', uri: notebookUri },
		}, getPath).lead).toBe('A cell in analysis.ipynb raised an error. Fix the error.');
	});

	it('names the chunk for a Quarto error', () => {
		expect(getErrorPrompt('explain', {
			error: 'boom',
			location: { kind: 'quarto', uri: { path: '/work/report.qmd' } as Uri, languageId: 'r', startLine: 10, endLine: 12 },
		}, getPath).lead).toBe(
			'The r code chunk at lines 10-12 of report.qmd raised an error. Explain what caused the error and how to fix it, without making changes or editing any files.'
		);
	});

	it('sends only the task when the error has no location or output', () => {
		expect(getErrorPrompt('fix', { error: '' }, getPath)).toEqual({ lead: 'Fix the error.', body: '' });
	});

	it('lengthens the fence past any backticks in the code or error', () => {
		const location = { ...consoleContext.location as positron.ai.ConsoleErrorLocation, code: 'x = "```"' };
		expect(getErrorPrompt('fix', { error: 'code: ````x````', location }, getPath).body).toBe(
			'Code:\n\n````python\nx = "```"\n````\n\nError:\n\n`````\ncode: ````x````\n`````'
		);
	});

	it('keeps the lead on one line', () => {
		const location = { ...consoleContext.location as positron.ai.ConsoleErrorLocation, sessionName: 'Python\nnext line' };
		expect(getErrorPrompt('fix', { ...consoleContext, location }, getPath).lead).not.toContain('\n');
	});
});

describe('canInlineBody', () => {
	it('moves a very long body to a file', () => {
		const location = { ...consoleContext.location as positron.ai.ConsoleErrorLocation, code: 'x = 1\n'.repeat(2000) };
		expect(canInlineBody(getErrorPrompt('fix', consoleContext, getPath))).toBe(true);
		expect(canInlineBody(getErrorPrompt('fix', { ...consoleContext, location }, getPath))).toBe(false);
	});
});

describe('formatFilePrompt', () => {
	const prompt = { lead: 'Fix the error.', body: 'Error:\n\n```\nboom\n```' };

	it('@-mentions the file holding the body', () => {
		expect(formatFilePrompt(prompt, '/tmp/positron-claude-code/error-1.md'))
			.toBe('Fix the error. The details are in @/tmp/positron-claude-code/error-1.md');
	});

	it('quotes a path that contains spaces', () => {
		expect(formatFilePrompt(prompt, 'C:\\Users\\Ada Lovelace\\error.md'))
			.toBe('Fix the error. The details are in @"C:\\Users\\Ada Lovelace\\error.md"');
	});
});

describe('getClaudeCodeSurface', () => {
	it('opens a new chat when useTerminal is off', () => {
		expect(getClaudeCodeSurface('2.1.282', false)).toBe('chat');
	});

	it('opens a new terminal session when useTerminal is on', () => {
		expect(getClaudeCodeSurface('2.1.282', true)).toBe('terminal');
	});

	it('accepts the first versions that take a prompt', () => {
		expect(getClaudeCodeSurface('2.0.35', false)).toBe('chat');
		expect(getClaudeCodeSurface('2.0.24', true)).toBe('terminal');
	});

	it('rejects versions that ignore the prompt', () => {
		expect(getClaudeCodeSurface('2.0.34', false)).toBeUndefined();
		expect(getClaudeCodeSurface('2.0.23', true)).toBeUndefined();
		expect(getClaudeCodeSurface('1.0.126', false)).toBeUndefined();
	});
});

