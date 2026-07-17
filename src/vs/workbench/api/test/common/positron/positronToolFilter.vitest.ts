/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as vscode from 'vscode';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ParticipantID } from '../../../../contrib/positronAssistant/common/positronAssistantParticipants.js';
import { getEnabledTools } from '../../../common/positron/positronToolFilter.js';

/** Build a tool with a name and optional tags (the only fields the filter reads). */
function tool(name: string, tags: string[] = []): vscode.LanguageModelToolInformation {
	return stubInterface<vscode.LanguageModelToolInformation>({ name, tags });
}

/** Build a reference carrying an active-session context for a language. */
function sessionRef(languageId: string): vscode.ChatPromptReference {
	return stubInterface<vscode.ChatPromptReference>({ value: { activeSession: { languageId } } });
}

interface RequestOptions {
	vendor?: string;
	references?: readonly vscode.ChatPromptReference[];
	tools?: Map<vscode.LanguageModelToolInformation, boolean>;
	location2?: vscode.ChatRequestEditorData;
}

/** Build a chat request exposing only the fields the filter reads. */
function request(options: RequestOptions = {}): vscode.ChatRequest {
	return stubInterface<vscode.ChatRequest>({
		references: options.references ?? [],
		tools: options.tools,
		location2: options.location2,
		model: stubInterface<vscode.LanguageModelChat>({ vendor: options.vendor ?? 'copilot' }),
	});
}

describe('getEnabledTools', () => {
	it('enables ordinary tools for a non-Positron participant (agent mode)', () => {
		const tools = [tool('foo'), tool('bar')];
		expect(getEnabledTools(request(), tools, true)).toEqual(['foo', 'bar']);
	});

	it('includes Copilot tools only when the request uses a Copilot model', () => {
		const tools = [tool('copilot_search')];
		expect(getEnabledTools(request({ vendor: 'copilot' }), tools, true)).toEqual(['copilot_search']);
		expect(getEnabledTools(request({ vendor: 'anthropic' }), tools, true)).toEqual([]);
	});

	it('disables workspace tools when no workspace is open', () => {
		const tools = [tool('needsWorkspace', ['requires-workspace'])];
		expect(getEnabledTools(request(), tools, true)).toEqual(['needsWorkspace']);
		expect(getEnabledTools(request(), tools, false)).toEqual([]);
	});

	it('disables session tools when the required language has no active session', () => {
		const tools = [tool('rTool', ['requires-session:r'])];
		expect(getEnabledTools(request({ references: [sessionRef('python')] }), tools, true)).toEqual([]);
		expect(getEnabledTools(request({ references: [sessionRef('r')] }), tools, true)).toEqual(['rTool']);
	});

	it('respects tools disabled via the Configure Tools picker', () => {
		const disabled = tool('disabledByPicker');
		const enabled = tool('kept');
		const tools = [disabled, enabled];
		const picker = new Map([[disabled, false]]);
		expect(getEnabledTools(request({ tools: picker }), tools, true)).toEqual(['kept']);
	});

	it('only enables executeCode in the chat pane', () => {
		const tools = [tool('executeCode')];
		expect(getEnabledTools(request(), tools, true)).toEqual(['executeCode']);
		const inEditor = request({ location2: stubInterface<vscode.ChatRequestEditorData>({}) });
		expect(getEnabledTools(inEditor, tools, true)).toEqual([]);
	});

	it('disables all tools for the terminal participant', () => {
		const tools = [tool('foo')];
		expect(getEnabledTools(request(), tools, true, ParticipantID.Terminal)).toEqual([]);
	});
});
