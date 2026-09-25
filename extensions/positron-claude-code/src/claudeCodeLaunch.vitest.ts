/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { formatPrompt, getClaudeCodeLaunch } from './claudeCodeLaunch';

describe('formatPrompt', () => {
	it('inlines the error context as a fenced block after the prompt', () => {
		expect(formatPrompt({
			action: 'fix',
			prompt: 'Fix this console error.',
			context: 'NameError: name "x" is not defined',
			contextName: 'Console Error',
		})).toBe('Fix this console error.\n\nConsole Error:\n```\nNameError: name "x" is not defined\n```');
	});

	it('lengthens the fence past any backticks in the context', () => {
		expect(formatPrompt({
			action: 'explain',
			prompt: 'Explain this error.',
			context: 'code: ```x```',
			contextName: 'Notebook Cell Error',
		})).toBe('Explain this error.\n\nNotebook Cell Error:\n````\ncode: ```x```\n````');
	});

	it('sends only the prompt when there is no context', () => {
		expect(formatPrompt({ action: 'fix', prompt: 'Fix this.', context: '', contextName: 'Console Error' })).toBe('Fix this.');
	});
});

describe('getClaudeCodeLaunch', () => {
	it('opens a new chat with the prompt when useTerminal is off', () => {
		expect(getClaudeCodeLaunch('Fix it', '2.1.282', false)).toEqual({
			kind: 'command',
			command: 'claude-vscode.editor.open',
			args: [undefined, 'Fix it'],
		});
	});

	it('opens a new terminal session with the prompt when useTerminal is on', () => {
		expect(getClaudeCodeLaunch('Fix it', '2.1.282', true)).toEqual({
			kind: 'command',
			command: 'claude-vscode.terminal.open',
			args: ['Fix it'],
		});
	});

	it('accepts the first versions that take a prompt', () => {
		expect(getClaudeCodeLaunch('Fix it', '2.0.35', false).kind).toBe('command');
		expect(getClaudeCodeLaunch('Fix it', '2.0.24', true).kind).toBe('command');
	});

	it('reports versions that ignore the prompt as outdated', () => {
		expect(getClaudeCodeLaunch('Fix it', '2.0.34', false)).toEqual({ kind: 'outdated', minimumVersion: '2.0.35' });
		expect(getClaudeCodeLaunch('Fix it', '2.0.23', true)).toEqual({ kind: 'outdated', minimumVersion: '2.0.24' });
		expect(getClaudeCodeLaunch('Fix it', '1.0.126', false).kind).toBe('outdated');
	});
});
