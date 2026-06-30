/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { isAbsolute, join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IMcpCallToolResult, McpContent } from '../../../../platform/positronMcp/common/positronMcpTools.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesInstance } from '../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { Variable } from '../../../services/languageRuntime/common/positronVariablesComm.js';
import { IPositronAssistantService } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { IPositronMcpToolService } from './positronMcpToolService.js';
import {
	formatPackages,
	formatTableProfile,
	formatVariableDetail,
	formatVariables,
	imageResult,
	textResult,
} from './positronMcpFormat.js';

/** A tool handler: receives its arguments, returns an MCP result. */
type ToolHandler = (args: Record<string, unknown>) => Promise<IMcpCallToolResult>;

/** Default timeout for kernel-backed queries; mirrors the extension's executionTimeout. */
const EXECUTION_TIMEOUT_KEY = 'positron.mcp.executionTimeout';
const DEFAULT_EXECUTION_TIMEOUT = 30000;

function errorResult(text: string): IMcpCallToolResult {
	const content: McpContent[] = [{ type: 'text', text }];
	return { content, isError: true };
}

/**
 * Renderer-side MCP tool registry. Each tool calls workbench services directly,
 * the in-process equivalents of the `positron.*` API the extension used.
 */
export class PositronMcpToolService extends Disposable implements IPositronMcpToolService {
	declare readonly _serviceBrand: undefined;

	private readonly _handlers = new Map<string, ToolHandler>();

	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IPositronVariablesService private readonly _variablesService: IPositronVariablesService,
		@IPositronAssistantService private readonly _assistantService: IPositronAssistantService,
		@IMarkerService private readonly _markerService: IMarkerService,
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
		this._handlers.set('get-session', () => this._getSession());
		this._handlers.set('get-variables', () => this._getVariables());
		this._handlers.set('inspect-variable', args => this._inspectVariable(args));
		this._handlers.set('profile-data', args => this._profileData(args));
		this._handlers.set('get-packages', () => this._getPackages());
		this._handlers.set('get-active-document', args => this._getActiveDocument(args));
		this._handlers.set('get-workspace-info', () => this._getWorkspaceInfo());
		this._handlers.set('get-diagnostics', args => this._getDiagnostics(args));
		this._handlers.set('get-plot', () => this._getPlot());
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<IMcpCallToolResult> {
		const handler = this._handlers.get(name);
		if (!handler) {
			return errorResult(`Tool '${name}' is not implemented in this Positron window.`);
		}
		try {
			return await handler(args);
		} catch (error) {
			return errorResult(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// --- Session / variables -------------------------------------------------

	private get _timeoutMs(): number {
		return this._configurationService.getValue<number>(EXECUTION_TIMEOUT_KEY) ?? DEFAULT_EXECUTION_TIMEOUT;
	}

	/** The foreground session and its variables instance, or undefined if none. */
	private _foregroundVariables(): { session: ILanguageRuntimeSession; instance: IPositronVariablesInstance } | undefined {
		const session = this._runtimeSessionService.foregroundSession;
		if (!session) {
			return undefined;
		}
		const instance = this._variablesService.positronVariablesInstances.find(i => i.session.sessionId === session.sessionId);
		return instance ? { session, instance } : undefined;
	}

	/** List a session's variables (optionally drilling into one via its access key). */
	private async _listVariables(instance: IPositronVariablesInstance, accessKeys?: string[][]): Promise<Variable[][]> {
		const client = instance.getClientInstance();
		if (!client) {
			throw new Error(`No variables provider available for session ${instance.session.sessionId}`);
		}
		if (accessKeys && accessKeys.length > 0 && accessKeys.some(k => k.length !== 0)) {
			const result: Variable[][] = [];
			for (const accessKey of accessKeys) {
				result.push((await client.comm.inspect(accessKey)).children);
			}
			return result;
		}
		const allVars = await client.comm.list();
		return [allVars.variables];
	}

	private async _getSession(): Promise<IMcpCallToolResult> {
		const session = this._runtimeSessionService.foregroundSession;
		if (!session) {
			return textResult('No active runtime session. Use session-start to begin one.');
		}
		return textResult([
			`Runtime Session: ${session.dynState.sessionName}`,
			`Language: ${session.runtimeMetadata.languageId}`,
			`Mode: ${session.metadata.sessionMode}`,
			`Session ID: ${session.metadata.sessionId}`,
		].join('\n'));
	}

	private async _getVariables(): Promise<IMcpCallToolResult> {
		const fg = this._foregroundVariables();
		if (!fg) {
			return textResult('No active runtime session. Start a Python/R console to see variables.');
		}
		const variables = (await this._listVariables(fg.instance)).flat();
		return textResult(formatVariables(variables, fg.session.runtimeMetadata.languageName));
	}

	private async _inspectVariable(args: Record<string, unknown>): Promise<IMcpCallToolResult> {
		const name = typeof args.name === 'string' ? args.name : '';
		if (!name.trim()) {
			throw new Error('name is required');
		}
		const fg = this._foregroundVariables();
		if (!fg) {
			return textResult('No active runtime session. Start a Python/R console first.');
		}
		const variable = (await this._listVariables(fg.instance)).flat().find(v => v.display_name === name);
		if (!variable) {
			return textResult(`No variable named "${name}" in the active session. Use get-variables to list what is defined.`);
		}
		let children: Variable[] = [];
		if (variable.has_children) {
			children = (await this._listVariables(fg.instance, [[variable.access_key]]))[0] ?? [];
		}
		return textResult(formatVariableDetail(variable, children));
	}

	private async _profileData(args: Record<string, unknown>): Promise<IMcpCallToolResult> {
		const name = typeof args.name === 'string' ? args.name : '';
		const columns = Array.isArray(args.columns) ? args.columns.filter((c): c is string => typeof c === 'string') : undefined;
		if (!name.trim()) {
			throw new Error('name is required');
		}
		const fg = this._foregroundVariables();
		if (!fg) {
			return textResult('No active runtime session. Start a Python/R console first.');
		}
		const variable = (await this._listVariables(fg.instance)).flat().find(v => v.display_name === name);
		if (!variable) {
			return textResult(`No variable named "${name}" in the active session. Use get-variables to list what is defined.`);
		}

		// The kernel query queues behind any running computation on the
		// single-threaded kernel, so race it against a timeout rather than hang.
		const client = fg.instance.getClientInstance();
		if (!client) {
			return textResult('No variables provider available for the active session.');
		}
		const outcome = await raceTimeout(
			client.comm.queryTableSummary([variable.access_key], ['summary_stats']),
			this._timeoutMs,
		);
		if (outcome.timedOut) {
			return textResult(`Profiling "${name}" timed out after ${this._timeoutMs} ms; the session may be busy running code. Wait for it to finish, or call session-interrupt, then try again.`);
		}
		if (!outcome.ok) {
			return textResult(`Could not profile "${name}": ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}. profile-data works on dataframe variables; use inspect-variable for other types.`);
		}
		if (!outcome.value) {
			return textResult(`No profile data was returned for "${name}".`);
		}
		return textResult(formatTableProfile(name, outcome.value, columns));
	}

	private async _getPackages(): Promise<IMcpCallToolResult> {
		const session = this._runtimeSessionService.foregroundSession;
		if (!session) {
			return textResult('No active runtime session. Start a Python/R console first.');
		}
		const packageManager = session.getPackageManager?.();
		if (!packageManager) {
			return textResult('Could not list packages for this session: the runtime does not support package management.');
		}
		const outcome = await raceTimeout(packageManager.getPackages(CancellationToken.None), this._timeoutMs);
		if (outcome.timedOut) {
			return textResult(`Listing packages timed out after ${this._timeoutMs} ms; the session may be busy running code. Wait for it to finish, or call session-interrupt, then try again.`);
		}
		if (!outcome.ok) {
			return textResult(`Could not list packages for this session: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`);
		}
		return textResult(formatPackages(outcome.value, session.runtimeMetadata.languageName));
	}

	// --- Editor / workspace / diagnostics / plot -----------------------------

	private async _getActiveDocument(args: Record<string, unknown>): Promise<IMcpCallToolResult> {
		const includeContent = args.includeContent === true;
		const includeSelection = args.includeSelection !== false;

		const editor = this._editorService.activeTextEditorControl;
		if (!isCodeEditor(editor)) {
			return textResult(JSON.stringify({ document: null, selection: null }));
		}
		const model = editor.getModel();
		if (!model) {
			return textResult(JSON.stringify({ document: null, selection: null }));
		}

		const result: Record<string, unknown> = {
			document: {
				uri: model.uri.toString(),
				languageId: model.getLanguageId(),
				fileName: model.uri.fsPath,
				lineCount: model.getLineCount(),
				isDirty: this._editorService.activeEditor?.isDirty() ?? false,
			},
		};
		if (includeContent) {
			(result.document as Record<string, unknown>).content = model.getValue();
		}
		if (includeSelection) {
			const selection = editor.getSelection();
			result.selection = !selection || selection.isEmpty() ? null : {
				text: model.getValueInRange(selection),
				range: {
					start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
					end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
				},
			};
		}
		return textResult(JSON.stringify(result));
	}

	private async _getWorkspaceInfo(): Promise<IMcpCallToolResult> {
		const folders = this._workspaceContextService.getWorkspace().folders.map(f => ({ uri: f.uri.toString(), name: f.name, index: f.index }));
		return textResult(JSON.stringify({ folders }));
	}

	private async _getDiagnostics(args: Record<string, unknown>): Promise<IMcpCallToolResult> {
		const inputPath = typeof args.path === 'string' ? args.path : undefined;
		let uri: URI;
		if (inputPath) {
			if (isAbsolute(inputPath)) {
				uri = URI.file(inputPath);
			} else {
				const folder = this._workspaceContextService.getWorkspace().folders[0];
				if (!folder) {
					return textResult('No workspace folder is open; pass an absolute path.');
				}
				uri = URI.file(join(folder.uri.fsPath, inputPath));
			}
		} else {
			const model = isCodeEditor(this._editorService.activeTextEditorControl) ? this._editorService.activeTextEditorControl.getModel() : undefined;
			if (!model) {
				return textResult('No active document; pass a path.');
			}
			uri = model.uri;
		}

		const markers = this._markerService.read({ resource: uri });
		if (markers.length === 0) {
			return textResult(`No diagnostics reported for ${uri.fsPath}. (If the file has not been opened in the editor, the language server may not have analyzed it yet.)`);
		}
		const lines = markers.map(m => {
			const position = `${m.startLineNumber}:${m.startColumn}`;
			const severity = severityName(m.severity);
			const source = m.source ? ` [${m.source}]` : '';
			const code = m.code ? ` (${typeof m.code === 'object' ? m.code.value : m.code})` : '';
			return `${position} - ${severity}${source}${code} - ${m.message}`;
		});
		return textResult(`Diagnostics for ${uri.fsPath} (${markers.length}):\n\n${lines.join('\n')}`);
	}

	private async _getPlot(): Promise<IMcpCallToolResult> {
		const uri = this._assistantService.getCurrentPlotUri();
		if (!uri) {
			return textResult('No plot is currently displayed in the Plots pane. Run plotting code first, then call get-plot.');
		}
		const match = uri.match(/^data:([^;]+);base64,(.+)$/s);
		if (!match) {
			return errorResult('The active plot could not be decoded.');
		}
		// The image is returned untruncated: it is the whole point, and the server
		// is localhost-only.
		return imageResult(match[1], match[2]);
	}
}

/** Map an IMarkerService severity to the label the extension used. */
function severityName(severity: MarkerSeverity): string {
	switch (severity) {
		case MarkerSeverity.Error: return 'Error';
		case MarkerSeverity.Warning: return 'Warning';
		case MarkerSeverity.Info: return 'Information';
		case MarkerSeverity.Hint: return 'Hint';
		default: return 'Unknown';
	}
}

type RaceOutcome<T> =
	| { timedOut: true }
	| { timedOut: false; ok: true; value: T }
	| { timedOut: false; ok: false; error: unknown };

/**
 * Race a promise against a timeout, settling to a tagged outcome so the
 * abandoned promise never rejects unhandled. Mirrors the extension's pattern for
 * kernel-backed queries that can queue behind running computation.
 */
async function raceTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<RaceOutcome<T>> {
	const settled = promise.then(
		(value): RaceOutcome<T> => ({ timedOut: false, ok: true, value }),
		(error): RaceOutcome<T> => ({ timedOut: false, ok: false, error }),
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<RaceOutcome<T>>(resolve => {
		timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
	});
	try {
		return await Promise.race([settled, timeout]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}
