/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { formatPrompt, formatTerminalPrompt, getClaudeCodeSurface, getLatestSessionId, getProjectDirName, supportsTerminalArgs } from './claudeCodeLaunch';

describe('formatPrompt', () => {
	it('inlines the error context as a fenced block after the prompt', () => {
		expect(formatPrompt({
			action: 'fix',
			conversation: 'new',
			prompt: 'Fix this console error.',
			context: 'NameError: name "x" is not defined',
			contextName: 'Console Error',
		})).toBe('Fix this console error.\n\n```\nNameError: name "x" is not defined\n```');
	});

	it('lengthens the fence past any backticks in the context', () => {
		expect(formatPrompt({
			action: 'explain',
			conversation: 'new',
			prompt: 'Explain this error.',
			context: 'code: ```x```',
			contextName: 'Notebook Cell Error',
		})).toBe('Explain this error.\n\n````\ncode: ```x```\n````');
	});

	it('sends only the prompt when there is no context', () => {
		expect(formatPrompt({ action: 'fix', conversation: 'new', prompt: 'Fix this.', context: '', contextName: 'Console Error' })).toBe('Fix this.');
	});
});

describe('formatTerminalPrompt', () => {
	const request = { action: 'fix' as const, conversation: 'new' as const, prompt: 'Fix this console error.', context: 'Error:\n! boom', contextName: 'Console Error' };

	it('keeps the prompt on one line and @-mentions the context file', () => {
		expect(formatTerminalPrompt(request, '/tmp/positron-claude-code/error-1.txt'))
			.toBe('Fix this console error. @/tmp/positron-claude-code/error-1.txt');
	});

	it('quotes a context path that contains spaces', () => {
		expect(formatTerminalPrompt(request, 'C:\\Users\\Ada Lovelace\\error.txt'))
			.toBe('Fix this console error. @"C:\\Users\\Ada Lovelace\\error.txt"');
	});

	it('flattens newlines in the prompt itself', () => {
		expect(formatTerminalPrompt({ ...request, prompt: 'Explain.\nDo not edit files.' }, undefined))
			.toBe('Explain. Do not edit files.');
	});
});

describe('getClaudeCodeSurface', () => {
	it('opens a new chat when useTerminal is off', () => {
		expect(getClaudeCodeSurface('2.1.282', false)).toEqual({ kind: 'chat' });
	});

	it('opens a new terminal session when useTerminal is on', () => {
		expect(getClaudeCodeSurface('2.1.282', true)).toEqual({ kind: 'terminal' });
	});

	it('accepts the first versions that take a prompt', () => {
		expect(getClaudeCodeSurface('2.0.35', false)).toEqual({ kind: 'chat' });
		expect(getClaudeCodeSurface('2.0.24', true)).toEqual({ kind: 'terminal' });
	});

	it('reports versions that ignore the prompt as outdated', () => {
		expect(getClaudeCodeSurface('2.0.34', false)).toEqual({ kind: 'outdated', minimumVersion: '2.0.35' });
		expect(getClaudeCodeSurface('2.0.23', true)).toEqual({ kind: 'outdated', minimumVersion: '2.0.24' });
		expect(getClaudeCodeSurface('1.0.126', false)).toEqual({ kind: 'outdated', minimumVersion: '2.0.35' });
	});
});

describe('supportsTerminalArgs', () => {
	it('starts at 2.0.42', () => {
		expect(supportsTerminalArgs('2.0.37')).toBe(false);
		expect(supportsTerminalArgs('2.0.42')).toBe(true);
	});
});

describe('getProjectDirName', () => {
	it('replaces every non-alphanumeric character with a dash', () => {
		expect(getProjectDirName('/Users/ada/my_project.v2')).toBe('-Users-ada-my-project-v2');
	});

	it('gives up on paths Claude Code would hash', () => {
		expect(getProjectDirName('/' + 'a'.repeat(250))).toBeUndefined();
	});
});

describe('getLatestSessionId', () => {
	it('picks the most recently modified session transcript', () => {
		expect(getLatestSessionId([
			{ name: '11111111-1111-1111-1111-111111111111.jsonl', mtimeMs: 1 },
			{ name: '22222222-2222-2222-2222-222222222222.jsonl', mtimeMs: 3 },
			{ name: 'notes.jsonl', mtimeMs: 5 },
		])).toBe('22222222-2222-2222-2222-222222222222');
	});

	it('returns undefined without sessions', () => {
		expect(getLatestSessionId([])).toBeUndefined();
	});
});
