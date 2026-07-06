/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { EditorType } from '../../../../../editor/common/editorCommon.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { IPositronMcpService } from '../../../../../platform/positronMcp/common/positronMcp.js';
import { IMcpUserContextData } from '../../../../../platform/positronMcp/common/positronMcpContext.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookInstance } from '../../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookService } from '../../../positronNotebook/browser/positronNotebookService.js';
import { PositronMcpNotebookTools } from '../../browser/positronMcpNotebook.js';
import { PositronMcpUserContextTool } from '../../browser/positronMcpUserContext.js';

const caller = { mcpSessionId: 'mcp-1', clientName: 'claude-code' };

function ledgerData(overrides: Partial<IMcpUserContextData> = {}): IMcpUserContextData {
	return {
		seq: 12,
		sinceOutOfRange: false,
		eventsEvicted: false,
		consoleEvents: [],
		consoleEventsOmitted: 0,
		errorEvents: [],
		errorEventsOmitted: 0,
		changed: { session: true, editor: true, notebooks: true },
		...overrides,
	};
}

function fakeForegroundSession(): ILanguageRuntimeSession {
	return stubInterface<ILanguageRuntimeSession>({
		dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName: 'Python 3.12.1' }),
		runtimeMetadata: stubInterface<ILanguageRuntimeSession['runtimeMetadata']>({ languageId: 'python', languageVersion: '3.12.1' }),
		metadata: stubInterface<ILanguageRuntimeSession['metadata']>({ sessionMode: LanguageRuntimeSessionMode.Console, sessionId: 'py-abc' }),
	});
}

function fakeEditor(options: { selection?: Selection } = {}): ICodeEditor {
	const model = stubInterface<ITextModel>({
		uri: URI.file('/work/analysis.py'),
		getLanguageId: () => 'python',
		getValueInRange: () => 'df.head()',
	});
	return stubInterface<ICodeEditor>({
		getEditorType: () => EditorType.ICodeEditor,
		getModel: () => model,
		getPosition: () => new Position(5, 3),
		getSelection: () => options.selection ?? new Selection(5, 3, 5, 3),
	});
}

interface IToolOptions {
	session?: ILanguageRuntimeSession;
	editor?: ICodeEditor;
	notebooks?: { path: string; active?: boolean }[];
	data?: IMcpUserContextData;
}

function createTool(options: IToolOptions = {}) {
	const queryUserContext = vi.fn(async () => options.data ?? ledgerData());
	const instances = (options.notebooks ?? []).map(nb => stubInterface<IPositronNotebookInstance>({ uri: URI.file(nb.path) }));
	const active = instances[(options.notebooks ?? []).findIndex(nb => nb.active)];
	const tool = new PositronMcpUserContextTool(
		stubInterface<IRuntimeSessionService>({ foregroundSession: options.session }),
		stubInterface<IEditorService>({ activeTextEditorControl: options.editor }),
		stubInterface<IPositronNotebookService>({ listInstances: () => instances }),
		stubInterface<PositronMcpNotebookTools>({ resolveNotebook: () => active }),
		stubInterface<IPositronMcpService>({ queryUserContext }),
	);
	return { tool, queryUserContext };
}

async function response(tool: PositronMcpUserContextTool, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
	const result = await tool.handle(args, caller);
	expect(result.content[0].type).toBe('text');
	return JSON.parse((result.content[0] as { text: string }).text);
}

describe('PositronMcpUserContextTool', () => {
	it('composes the live state snapshot: session, editor with cursor and selection, notebooks with the tool target marked', async () => {
		const { tool } = createTool({
			session: fakeForegroundSession(),
			editor: fakeEditor({ selection: new Selection(5, 3, 5, 12) }),
			notebooks: [{ path: '/work/a.ipynb' }, { path: '/work/b.ipynb', active: true }],
		});
		expect(await response(tool)).toEqual({
			seq: 12,
			session: { name: 'Python 3.12.1', languageId: 'python', languageVersion: '3.12.1', mode: 'console', sessionId: 'py-abc' },
			editor: {
				path: '/work/analysis.py',
				kind: 'text',
				languageId: 'python',
				cursor: { line: 4, character: 2 },
				selection: { text: 'df.head()', range: { start: { line: 4, character: 2 }, end: { line: 4, character: 11 } } },
			},
			console: [],
			notebooks: [
				{ path: '/work/a.ipynb', isToolTarget: false },
				{ path: '/work/b.ipynb', isToolTarget: true },
			],
			errors: [],
		});
	});

	it('reports null state when nothing is active (still a stable shape)', async () => {
		const { tool } = createTool();
		expect(await response(tool)).toEqual({
			seq: 12,
			session: null,
			editor: null,
			console: [],
			notebooks: [],
			errors: [],
		});
	});

	it('reports an empty selection as null with the cursor still present', async () => {
		const { tool } = createTool({ editor: fakeEditor() });
		const editor = (await response(tool)).editor as Record<string, unknown>;
		expect(editor.cursor).toEqual({ line: 4, character: 2 });
		expect(editor.selection).toBeNull();
	});

	it('falls back to the open notebook when no text editor is focused', async () => {
		const { tool } = createTool({ notebooks: [{ path: '/work/nb.ipynb', active: true }] });
		expect((await response(tool)).editor).toEqual({ path: '/work/nb.ipynb', kind: 'notebook' });
	});

	it('threads the caller identity, since, maxConsoleEntries, and include into the ledger query', async () => {
		const { tool, queryUserContext } = createTool();
		await tool.handle({ include: ['console'], since: 8, maxConsoleEntries: 2 }, caller);
		expect(queryUserContext).toHaveBeenCalledWith({ mcpSessionId: 'mcp-1', since: 8, maxConsoleEntries: 2, include: ['console'] });
	});

	it('refuses to run without a caller context (attribution cannot be scoped)', async () => {
		const { tool } = createTool();
		await expect(tool.handle({}, undefined)).rejects.toThrow(/MCP session context/);
	});
});
