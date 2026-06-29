/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import express, { Request, Response } from 'express';
import { Server } from 'node:http';
import * as path from 'node:path';
import { getLogger } from './logger';
import { MinimalSecurityMiddleware, loadSecurityConfig } from './security.positron';

interface McpRequest {
	jsonrpc: string;
	id?: string | number;
	method: string;
	params?: any;
}

interface McpResponse {
	jsonrpc: string;
	id?: string | number;
	result?: any;
	error?: { code: number; message: string };
}

interface ExecOptions {
	focus?: boolean;
	allowIncomplete?: boolean;
	mode?: 'interactive' | 'non-interactive' | 'transient' | 'silent';
	errorBehavior?: 'stop' | 'continue';
}

/** A block of MCP tool-result content (the wire shape sent to the client). */
type McpContent =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string };

/** One MCP tool: its advertised schema plus a handler returning the result payload. */
interface Tool {
	name: string;
	description: string;
	inputSchema: object;
	run: (args: any) => Promise<string | McpContent[]>;
}

/** A tool failure that carries a specific JSON-RPC error code. */
class ToolError extends Error {
	constructor(readonly code: number, message: string) {
		super(message);
	}
}

const EXECUTION_MODES: Record<string, positron.RuntimeCodeExecutionMode> = {
	'interactive': positron.RuntimeCodeExecutionMode.Interactive,
	'non-interactive': positron.RuntimeCodeExecutionMode.NonInteractive,
	'transient': positron.RuntimeCodeExecutionMode.Transient,
	'silent': positron.RuntimeCodeExecutionMode.Silent,
};

/** Jupyter kernelspecs for notebooks created via the notebook-create tool. */
const KERNELSPECS: Record<string, { display_name: string; language: string; name: string }> = {
	python: { display_name: 'Python 3', language: 'python', name: 'python3' },
	r: { display_name: 'R', language: 'R', name: 'ir' },
};

/** Cell-output MIME types whose data is plain text worth returning to the client. */
const TEXT_OUTPUT_MIMES = new Set([
	'text/plain',
	'application/vnd.code.notebook.stdout',
	'application/vnd.code.notebook.stderr',
	'application/vnd.code.notebook.error',
	'application/x.notebook.stdout',
	'application/x.notebook.stderr',
	'application/x.notebook.error',
	'application/x.notebook.stream',
]);

const MAX_OUTPUT_LENGTH = 8 * 1024;

function isTextOutputMime(mimeType: string): boolean {
	return TEXT_OUTPUT_MIMES.has(mimeType.split(';')[0].trim().toLowerCase());
}

function truncateOutput(text: string): string {
	return text.length > MAX_OUTPUT_LENGTH
		? text.slice(0, MAX_OUTPUT_LENGTH) + '\n\n[output truncated]'
		: text;
}

function parsePort(): number {
	const DEFAULT_PORT = 43123;
	const raw = process.env.POSITRON_MCP_PORT;
	if (!raw?.trim()) {
		return DEFAULT_PORT;
	}
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : DEFAULT_PORT;
}

function toolResult(id: McpRequest['id'], value: string | McpContent[]): McpResponse {
	const content = typeof value === 'string' ? [{ type: 'text', text: value }] : value;
	return { jsonrpc: '2.0', id, result: { content } };
}

function errorResult(id: McpRequest['id'], code: number, message: string): McpResponse {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Guidance returned in the `initialize` response `instructions` field. MCP
 * clients (Claude Code, Codex) surface this to the model as server-wide
 * guidance and prioritize the opening, so keep the most important framing first
 * and the whole string well under the ~2KB clients retain. Keep it in sync with
 * the tools defined in `buildTools()`.
 */
const SERVER_INSTRUCTIONS = `These tools connect to a live Positron IDE session running Python and/or R that the user is working in interactively. When a task involves running code, inspecting data, plotting, or editing notebooks, prefer these tools over your own shell or file-editing tools, so your work shares the user's live session state and stays visible to them.

Running code: use execute-code to run code in the active session. Variables, imports, and loaded data persist across calls and are shared with the user -- do not spawn a separate interpreter. Use foreground-session to see the active language/session and get-variables to inspect what is defined.

Plots: after running code that produces a plot, call get-plot to see the rendered image from the Plots pane.

Notebooks: use notebook-read, notebook-edit, notebook-run-cells, and notebook-create. Never read or hand-edit the .ipynb file or parse its JSON -- that corrupts notebook state. Cells are 0-indexed and indices shift after an insert or delete, so re-read before further edits.

Data: inspect structure with get-variables before writing code against a dataframe; do not guess column names. Use get-diagnostics for a file's errors/warnings, and session-interrupt / session-restart if the session hangs.`;

export class McpServer implements vscode.Disposable {
	private readonly app: express.Express;
	private server: Server | undefined;
	private readonly logger = getLogger();
	private readonly securityMiddleware: MinimalSecurityMiddleware;
	private readonly port = parsePort();
	private readonly tools: Tool[];

	constructor(context: vscode.ExtensionContext) {
		this.app = express();
		this.securityMiddleware = new MinimalSecurityMiddleware(loadSecurityConfig(), context);
		this.tools = this.buildTools();
		this.setupMiddleware();
		this.setupRoutes();
	}

	private setupMiddleware(): void {
		// JSON parsing must come before the security middleware that inspects the body.
		this.app.use(express.json());
		this.app.use(this.securityMiddleware.corsMiddleware());
		this.app.use(this.securityMiddleware.requestValidationMiddleware());
		this.app.use(this.securityMiddleware.rateLimitMiddleware());
		this.app.use(this.securityMiddleware.auditLoggingMiddleware());
	}

	private setupRoutes(): void {
		this.app.options('*', (_req: Request, res: Response) => res.sendStatus(200));
		this.app.post('/', (req: Request, res: Response) => this.handleMcpRequest(req, res));
		this.app.get('/health', (_req: Request, res: Response) => {
			res.json({ status: 'ok', server: 'positron-mcp-server' });
		});
	}

	private async handleMcpRequest(req: Request, res: Response): Promise<void> {
		try {
			const request: McpRequest = req.body;
			this.logger.debug('MCP.Request', request.method, request.params);
			res.json(await this.processRequest(request));
		} catch (error) {
			this.logger.error('MCP.Handler', 'Error handling MCP request', error);
			res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
		}
	}

	private async processRequest(request: McpRequest): Promise<McpResponse> {
		switch (request.method) {
			case 'initialize':
				return {
					jsonrpc: '2.0',
					id: request.id,
					result: {
						protocolVersion: '2024-11-05',
						capabilities: { tools: {} },
						serverInfo: { name: 'positron-mcp-server', version: '1.0.0' },
						instructions: SERVER_INSTRUCTIONS,
					},
				};
			case 'tools/list':
				return {
					jsonrpc: '2.0',
					id: request.id,
					result: { tools: this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
				};
			case 'tools/call':
				return await this.handleToolCall(request);
			default:
				return errorResult(request.id, -32601, 'Method not found');
		}
	}

	private async handleToolCall(request: McpRequest): Promise<McpResponse> {
		const toolName = request.params?.name;
		const tool = this.tools.find(t => t.name === toolName);
		if (!tool) {
			return errorResult(request.id, -32601, `Tool '${toolName}' not found`);
		}

		this.logger.debug('MCP.Tool', `Executing tool: ${toolName}`, request.params?.arguments);
		try {
			return toolResult(request.id, await tool.run(request.params?.arguments ?? {}));
		} catch (error) {
			if (error instanceof ToolError) {
				return errorResult(request.id, error.code, error.message);
			}
			return errorResult(request.id, -32603, `${toolName} failed: ${error}`);
		}
	}

	private buildTools(): Tool[] {
		const empty = { type: 'object', properties: {}, additionalProperties: false };
		return [
			{
				name: 'get-time',
				description: 'Get the current time in ISO format',
				inputSchema: empty,
				run: async () => JSON.stringify({ time: new Date().toISOString() }),
			},
			{
				name: 'foreground-session',
				description: 'Get current runtime session - Returns active Python/R/JS console information',
				inputSchema: empty,
				run: () => this.describeForegroundSession(),
			},
			{
				name: 'get-variables',
				description: 'Get the current variables state for the active runtime session',
				inputSchema: empty,
				run: () => this.describeVariables(),
			},
			{
				name: 'execute-code',
				description: 'Execute code in the active runtime session. Runs in the user\'s live, shared session, so variables and imports persist across calls; prefer this over spawning a separate interpreter.',
				inputSchema: {
					type: 'object',
					properties: {
						languageId: { type: 'string', description: 'Language identifier (python, r, etc.)', enum: ['python', 'r', 'javascript', 'typescript'] },
						code: { type: 'string', description: 'Code to execute' },
						options: {
							type: 'object',
							properties: {
								focus: { type: 'boolean', default: false },
								mode: { type: 'string', enum: ['interactive', 'non-interactive', 'transient', 'silent'], default: 'interactive' },
								allowIncomplete: { type: 'boolean', default: false },
							},
						},
					},
					required: ['languageId', 'code'],
				},
				run: (args) => this.executeCodeTool(args),
			},
			{
				name: 'get-active-document',
				description: 'Get information about the currently active document',
				inputSchema: {
					type: 'object',
					properties: {
						includeContent: { type: 'boolean', default: false },
						includeSelection: { type: 'boolean', default: true },
					},
				},
				run: async (args) => JSON.stringify(this.describeActiveDocument(args)),
			},
			{
				name: 'get-workspace-info',
				description: 'Get comprehensive workspace information',
				inputSchema: {
					type: 'object',
					properties: {
						includeConfig: { type: 'boolean', default: true },
						configSection: { type: 'string' },
					},
				},
				run: async (args) => JSON.stringify(await this.describeWorkspace(args)),
			},
			{
				name: 'notebook-read',
				description: 'Read cells of the active Positron notebook. Returns each cell\'s index, type, content, and execution status. Optionally read specific cells by index and include their text outputs. Use this instead of opening the .ipynb file directly.',
				inputSchema: {
					type: 'object',
					properties: {
						cellIndices: { type: 'array', items: { type: 'integer' }, description: '0-based cell indices to read. If omitted, reads all cells.' },
						includeOutputs: { type: 'boolean', default: false, description: 'Include the text outputs of executed code cells.' },
					},
				},
				run: (args) => this.readNotebook(args),
			},
			{
				name: 'notebook-edit',
				description: 'Edit the active Positron notebook: insert a new cell (optionally running it), update an existing cell\'s content, or delete a cell. Do not hand-edit the .ipynb file; cell indices shift after an insert or delete, so re-read before further edits.',
				inputSchema: {
					type: 'object',
					properties: {
						editMode: { type: 'string', enum: ['insert', 'update', 'delete'], description: 'The kind of edit to make.' },
						cellIndex: { type: 'integer', description: '0-based index. Required for update and delete. For insert, the position to insert at (omit to append at the end).' },
						content: { type: 'string', description: 'Cell content. Required for insert and update.' },
						cellType: { type: 'string', enum: ['code', 'markdown'], description: 'Cell type. Required for insert.' },
						run: { type: 'boolean', default: false, description: 'If inserting a code cell, execute it immediately and return its output.' },
					},
					required: ['editMode'],
				},
				run: (args) => this.editNotebook(args),
			},
			{
				name: 'notebook-run-cells',
				description: 'Execute one or more cells in the active Positron notebook and return their text outputs.',
				inputSchema: {
					type: 'object',
					properties: {
						cellIndices: { type: 'array', items: { type: 'integer' }, description: '0-based cell indices to execute.' },
					},
					required: ['cellIndices'],
				},
				run: (args) => this.runNotebookCells(args),
			},
			{
				name: 'notebook-create',
				description: 'Create a new Jupyter notebook (.ipynb) with the given language kernel and open it in the editor. The notebook starts empty - use notebook-edit to add cells.',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'Path for the new notebook, relative to the workspace root (must end in .ipynb).' },
						language: { type: 'string', enum: ['python', 'r'], description: 'The kernel language for the notebook.' },
					},
					required: ['path', 'language'],
				},
				run: (args) => this.createNotebook(args),
			},
			{
				name: 'get-plot',
				description: 'Get the plot currently shown in the Positron Plots pane as an image. Run plotting code with execute-code first, then call this to see the result.',
				inputSchema: empty,
				run: () => this.getPlot(),
			},
			{
				name: 'session-interrupt',
				description: 'Interrupt the active runtime session to stop a long-running or stuck computation.',
				inputSchema: empty,
				run: () => this.interruptActiveSession(),
			},
			{
				name: 'session-restart',
				description: 'Restart the active runtime session. This clears all variables and loaded data; the user is asked to confirm first.',
				inputSchema: empty,
				run: () => this.restartActiveSession(),
			},
			{
				name: 'get-diagnostics',
				description: 'Get the diagnostics (errors, warnings) the language server has reported for a file. Defaults to the active editor.',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'Absolute path, or a path relative to the first workspace folder. If omitted, uses the active editor.' },
					},
				},
				run: (args) => this.getDiagnostics(args),
			},
		];
	}

	private async describeForegroundSession(): Promise<string> {
		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			return 'No active runtime session';
		}
		const dynState = await session.getDynState();
		return [
			`Runtime Session: ${dynState.sessionName}`,
			`Language: ${session.runtimeMetadata.languageId}`,
			`State: unknown`, // ponytail: positron exposes no synchronous session state here; original always fell back to 'unknown'
			`Mode: ${session.metadata.sessionMode}`,
			`Session ID: ${session.metadata.sessionId}`,
		].join('\n');
	}

	private async describeVariables(): Promise<string> {
		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			return 'No active runtime session. Start a Python/R console to see variables.';
		}

		const groups = await positron.runtime.getSessionVariables(session.metadata.sessionId);
		const variables = groups.flat().map(v => ({ name: v.display_name, type: v.display_type, value: v.display_value }));
		if (variables.length === 0) {
			return 'No variables in your workspace yet';
		}

		const lines = variables.map(v => {
			let display = v.value;
			if (display.includes('DataFrame')) {
				const match = display.match(/\[(\d+) rows x (\d+) columns\]/);
				if (match) {
					display = `DataFrame with ${match[1]} rows × ${match[2]} columns`;
				}
			} else if (display.length > 50) {
				display = display.substring(0, 50) + '...';
			}
			return `• ${v.name} - ${v.type} ${display ? `: ${display}` : ''}`;
		});

		// ponytail: hardcoded "Python" regardless of language -- preserved from original; the wording fix is a separate change.
		let text = `You have ${variables.length} variable${variables.length !== 1 ? 's' : ''} in your Python workspace:\n\n${lines.join('\n')}`;

		const dataframes = variables.filter(v => v.type.includes('DataFrame'));
		if (dataframes.length > 0) {
			const info = dataframes.map(df => {
				const match = df.value.match(/\[(\d+) rows x (\d+) columns\]/);
				return match ? `${df.name} (${match[1]} rows × ${match[2]} columns)` : df.name;
			});
			text += `\n\nDataFrames: ${info.join(', ')}`;
		}
		return text;
	}

	private async executeCodeTool(args: { languageId: string; code: string; options?: ExecOptions }): Promise<string> {
		const { languageId, code, options = {} } = args;

		await this.requireExecutionConsent(languageId, code);

		if (!languageId?.trim()) {
			throw new Error('languageId is required');
		}
		if (!code?.trim()) {
			throw new Error('code is required');
		}

		const { focus = false, allowIncomplete = false, mode = 'interactive', errorBehavior = 'stop' } = options;
		const executionMode = EXECUTION_MODES[mode] ?? positron.RuntimeCodeExecutionMode.Interactive;
		const errorMode = errorBehavior === 'continue' ? positron.RuntimeErrorBehavior.Continue : positron.RuntimeErrorBehavior.Stop;

		try {
			const data = await positron.runtime.executeCode(languageId, code, focus, allowIncomplete, executionMode, errorMode);
			return JSON.stringify({ success: true, data, metadata: { timestamp: new Date().toISOString() } });
		} catch (error) {
			return JSON.stringify({
				success: false,
				error: {
					name: error instanceof Error ? error.name : 'Error',
					message: error instanceof Error ? error.message : String(error),
					traceback: error instanceof Error && error.stack ? [error.stack] : [],
				},
			});
		}
	}

	private describeActiveDocument(args: { includeContent?: boolean; includeSelection?: boolean }): object {
		const { includeContent = false, includeSelection = true } = args;
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return { document: null, selection: null };
		}

		const doc = editor.document;
		const result: any = {
			document: {
				uri: doc.uri.toString(),
				languageId: doc.languageId,
				fileName: doc.fileName,
				lineCount: doc.lineCount,
				isDirty: doc.isDirty,
			},
		};
		if (includeContent) {
			result.document.content = doc.getText();
		}
		if (includeSelection) {
			const sel = editor.selection;
			result.selection = sel.isEmpty ? null : {
				text: doc.getText(sel),
				range: {
					start: { line: sel.start.line, character: sel.start.character },
					end: { line: sel.end.line, character: sel.end.character },
				},
			};
		}
		return result;
	}

	private async describeWorkspace(args: { includeConfig?: boolean; configSection?: string }): Promise<object> {
		const { includeConfig = true, configSection } = args;

		const folders = (vscode.workspace.workspaceFolders ?? []).map(f => ({ uri: f.uri.toString(), name: f.name, index: f.index }));
		const active = await positron.runtime.getForegroundSession();
		const sessions = await positron.runtime.getActiveSessions();
		const activeRuntimes = await Promise.all(sessions.map(async s => ({
			languageId: s.runtimeMetadata.languageId,
			sessionId: s.metadata.sessionId,
			sessionName: (await s.getDynState()).sessionName,
			isActive: active?.metadata.sessionId === s.metadata.sessionId,
		})));

		const result: any = { folders, activeRuntimes };
		if (includeConfig) {
			const config = vscode.workspace.getConfiguration(configSection);
			const configData: Record<string, any> = {};
			if (configSection) {
				const inspection = config.inspect('');
				if (inspection) {
					configData[configSection] = inspection;
				}
			} else {
				configData['positron.mcp.enable'] = config.get('positron.mcp.enable');
			}
			result.configuration = configData;
		}
		return result;
	}

	private async requireExecutionConsent(languageId: string, code: string): Promise<void> {
		const consented = await this.securityMiddleware.checkCodeExecutionConsent(languageId, code);
		if (!consented) {
			this.logger.warn('Security', 'Code execution denied by user');
			throw new ToolError(-32001, 'Code execution denied by user');
		}
	}

	private async collectCellOutputText(uri: string, cellIndices: number[]): Promise<string> {
		let text = '';
		for (const index of cellIndices) {
			const outputs = await positron.notebooks.getCellOutputs(uri, index);
			if (outputs.length === 0) {
				text += `Cell ${index}: (no output)\n`;
				continue;
			}
			text += `Cell ${index}:\n`;
			for (const output of outputs) {
				if (output.mimeType.startsWith('image/')) {
					text += `[image output: ${output.mimeType}]\n`;
				} else if (isTextOutputMime(output.mimeType)) {
					text += output.data + '\n';
				}
			}
		}
		return truncateOutput(text);
	}

	private async readNotebook(args: { cellIndices?: number[]; includeOutputs?: boolean }): Promise<string> {
		const context = await positron.notebooks.getContext();
		if (!context) {
			return 'No notebook is open in the editor. Open a notebook, then try again.';
		}
		const { cellIndices, includeOutputs = false } = args;

		const allCells = await positron.notebooks.getCells(context.uri);
		if (allCells.length === 0) {
			return 'The active notebook is empty (0 cells).';
		}

		const cells = cellIndices ? allCells.filter(c => cellIndices.includes(c.index)) : allCells;
		if (cells.length === 0) {
			return `No cells found at the requested indices. The notebook has ${allCells.length} cells (indices 0-${allCells.length - 1}).`;
		}

		let output = `Notebook: ${context.uri}\nTotal cells: ${allCells.length}`;
		if (cellIndices) {
			output += ` (showing ${cells.length})`;
		}
		output += '\n\n';

		for (const cell of cells) {
			const isCode = cell.type === positron.notebooks.NotebookCellType.Code;
			const status = cell.executionStatus ? ` [${cell.executionStatus}]` : '';
			output += `Cell ${cell.index} [${isCode ? 'CODE' : 'MARKDOWN'}]${status}\n${cell.content}\n\n`;
			if (includeOutputs && isCode && cell.hasOutput) {
				const outputs = await positron.notebooks.getCellOutputs(context.uri, cell.index);
				for (const o of outputs) {
					if (isTextOutputMime(o.mimeType)) {
						output += `Output:\n${o.data}\n\n`;
					}
				}
			}
		}
		return truncateOutput(output.trimEnd());
	}

	private async editNotebook(args: { editMode: string; cellIndex?: number; content?: string; cellType?: string; run?: boolean }): Promise<string> {
		const context = await positron.notebooks.getContext();
		if (!context) {
			return 'No notebook is open in the editor. Open a notebook, then try again.';
		}
		const uri = context.uri;
		const { editMode, cellIndex, content, cellType, run = false } = args;

		switch (editMode) {
			case 'insert': {
				if (!cellType) {
					throw new Error('cellType is required for insert mode');
				}
				if (content === undefined) {
					throw new Error('content is required for insert mode');
				}

				const runCell = run && cellType === 'code';
				if (runCell) {
					await this.requireExecutionConsent(context.kernelLanguage ?? 'code', content);
				}

				const cells = await positron.notebooks.getCells(uri);
				const insertIndex = cellIndex ?? cells.length;
				const type = cellType === 'code'
					? positron.notebooks.NotebookCellType.Code
					: positron.notebooks.NotebookCellType.Markdown;

				const newCellId = await positron.notebooks.addCell(uri, type, insertIndex, content);
				await positron.notebooks.scrollToCellIfNeeded(uri, insertIndex);

				if (runCell) {
					try {
						await positron.notebooks.runCells(uri, [insertIndex]);
						const outputText = await this.collectCellOutputText(uri, [insertIndex]);
						return `Inserted and ran code cell at index ${insertIndex} (id: ${newCellId}).\n\nOutput:\n${outputText}`;
					} catch (error) {
						return `Inserted code cell at index ${insertIndex} (id: ${newCellId}), but execution failed: ${error instanceof Error ? error.message : String(error)}`;
					}
				}
				return `Inserted ${cellType} cell at index ${insertIndex} (id: ${newCellId}).`;
			}

			case 'update': {
				if (cellIndex === undefined) {
					throw new Error('cellIndex is required for update mode');
				}
				if (content === undefined) {
					throw new Error('content is required for update mode');
				}
				await positron.notebooks.updateCellContent(uri, cellIndex, content);
				return `Updated cell ${cellIndex}.`;
			}

			case 'delete': {
				if (cellIndex === undefined) {
					throw new Error('cellIndex is required for delete mode');
				}
				await positron.notebooks.deleteCell(uri, cellIndex);
				return `Deleted cell ${cellIndex}.`;
			}

			default:
				throw new Error(`Unknown editMode: ${editMode}`);
		}
	}

	private async runNotebookCells(args: { cellIndices?: number[] }): Promise<string> {
		const context = await positron.notebooks.getContext();
		if (!context) {
			return 'No notebook is open in the editor. Open a notebook, then try again.';
		}
		const { cellIndices } = args;
		if (!cellIndices || cellIndices.length === 0) {
			throw new Error('cellIndices must be a non-empty array');
		}

		const uri = context.uri;
		const cells = await positron.notebooks.getCells(uri);
		const code = cellIndices.map(i => cells.find(c => c.index === i)?.content ?? '').join('\n\n');
		await this.requireExecutionConsent(context.kernelLanguage ?? 'code', code);

		await positron.notebooks.runCells(uri, cellIndices);
		const outputText = await this.collectCellOutputText(uri, cellIndices);
		return outputText || '(no output)';
	}

	private async createNotebook(args: { path: string; language: string }): Promise<string> {
		const { path: notebookPath, language } = args;
		if (!notebookPath?.trim()) {
			throw new Error('path is required');
		}
		if (!notebookPath.endsWith('.ipynb')) {
			throw new Error(`File must have a .ipynb extension: ${notebookPath}`);
		}
		const kernelspec = KERNELSPECS[language];
		if (!kernelspec) {
			throw new Error(`Unsupported language: ${language}`);
		}

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		const fullPath = path.isAbsolute(notebookPath)
			? notebookPath
			: workspaceFolder ? path.join(workspaceFolder.uri.fsPath, notebookPath) : undefined;
		if (!fullPath) {
			throw new Error('No workspace folder is open; provide an absolute path or open a folder.');
		}

		const fileUri = vscode.Uri.file(fullPath);
		try {
			await vscode.workspace.fs.stat(fileUri);
			throw new ToolError(-32602, `File already exists: ${notebookPath}`);
		} catch (error) {
			if (error instanceof ToolError) {
				throw error;
			}
			// stat throws when the file does not exist -- that is the expected path
		}

		await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fullPath)));
		const notebook = {
			cells: [],
			metadata: { kernelspec, language_info: { name: kernelspec.language } },
			nbformat: 4,
			nbformat_minor: 5,
		};
		await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(notebook, null, 2) + '\n', 'utf8'));

		// Open in the Positron notebook editor and wait for it to become active.
		// Register the listener before issuing the open command to avoid a race.
		try {
			const ready = new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					disposable.dispose();
					reject(new Error('Timed out waiting for the notebook editor to become active'));
				}, 5000);
				const disposable = vscode.window.onDidChangeActiveNotebookEditor((editor) => {
					if (editor?.notebook.uri.toString() === fileUri.toString()) {
						clearTimeout(timeout);
						disposable.dispose();
						resolve();
					}
				});
			});
			await vscode.commands.executeCommand('vscode.openWith', fileUri, 'workbench.editor.positronNotebook');
			await ready;
		} catch {
			return `Created notebook ${notebookPath}, but failed to open it in the editor. Open it manually, then use notebook-edit to add cells.`;
		}
		return `Created empty ${language} notebook: ${notebookPath}. It is open and active; use notebook-edit with editMode "insert" to add cells.`;
	}

	private async getPlot(): Promise<string | McpContent[]> {
		const uri = await positron.ai.getCurrentPlotUri();
		if (!uri) {
			return 'No plot is currently displayed in the Plots pane. Run plotting code first, then call get-plot.';
		}
		const match = uri.match(/^data:([^;]+);base64,(.+)$/s);
		if (!match) {
			throw new ToolError(-32603, 'The active plot could not be decoded.');
		}
		// Returned untruncated: the image is the whole point, and the server is
		// localhost-only. Truncating base64 would corrupt it, not shrink it.
		return [{ type: 'image', data: match[2], mimeType: match[1] }];
	}

	private async interruptActiveSession(): Promise<string> {
		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			return 'No active runtime session.';
		}
		await positron.runtime.interruptSession(session.metadata.sessionId);
		return 'Interrupted the active session.';
	}

	private async restartActiveSession(): Promise<string> {
		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			return 'No active runtime session.';
		}
		const dynState = await session.getDynState();
		// Restart wipes the session's state, so confirm first. (Positron itself only
		// prompts when the session is busy, and asks a different question -- whether to
		// interrupt -- so this is the only gate for an idle session.)
		const confirmed = await positron.window.showSimpleModalDialogPrompt(
			'Restart Session?',
			`${dynState.sessionName} will restart. All variables and loaded data will be lost.`,
			'Restart',
			'Cancel'
		);
		if (!confirmed) {
			throw new ToolError(-32001, 'Session restart declined by user');
		}
		try {
			// restartSession resolves false if the user declines Positron's busy-interrupt prompt.
			const restarted = await positron.runtime.restartSession(session.metadata.sessionId);
			if (!restarted) {
				throw new ToolError(-32001, 'Session restart declined by user');
			}
			return `Restarted ${dynState.sessionName}.`;
		} catch (error) {
			if (error instanceof ToolError) {
				throw error;
			}
			throw new ToolError(-32603, `Failed to restart session: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async getDiagnostics(args: { path?: string }): Promise<string> {
		let uri: vscode.Uri;
		if (args.path) {
			if (path.isAbsolute(args.path)) {
				uri = vscode.Uri.file(args.path);
			} else {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					return 'No workspace folder is open; pass an absolute path.';
				}
				uri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, args.path));
			}
		} else {
			const activeUri = vscode.window.activeTextEditor?.document.uri;
			if (!activeUri) {
				return 'No active document; pass a path.';
			}
			uri = activeUri;
		}

		const diagnostics = vscode.languages.getDiagnostics(uri);
		if (diagnostics.length === 0) {
			return `No diagnostics reported for ${uri.fsPath}. (If the file has not been opened in the editor, the language server may not have analyzed it yet.)`;
		}

		const severityNames = ['Error', 'Warning', 'Information', 'Hint'];
		const lines = diagnostics.map(d => {
			const position = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
			const severity = severityNames[d.severity] ?? 'Unknown';
			const source = d.source ? ` [${d.source}]` : '';
			const code = d.code ? ` (${typeof d.code === 'object' ? d.code.value : d.code})` : '';
			return `${position} - ${severity}${source}${code} - ${d.message}`;
		});
		return truncateOutput(`Diagnostics for ${uri.fsPath} (${diagnostics.length}):\n\n${lines.join('\n')}`);
	}

	async start(): Promise<void> {
		if (this.server) {
			return;
		}

		this.logger.info('Server', `MCP server starting on port ${this.port}`);
		return new Promise((resolve, reject) => {
			this.server = this.app.listen(this.port, 'localhost', () => {
				this.logger.info('Server', `MCP server started on http://localhost:${this.port}`);
				resolve();
			});
			this.server.on('error', (error) => {
				this.logger.error('Server', `Failed to start server on port ${this.port}`, error);
				reject(error);
			});
		});
	}

	dispose(): void {
		if (this.server) {
			this.server.close();
			this.server = undefined;
			this.logger.info('Server', 'MCP server stopped');
		}
	}

	getSecurityAuditLog(): any[] {
		return this.securityMiddleware.getAuditLog();
	}

	clearSecurityAuditLog(): void {
		this.securityMiddleware.clearAuditLog();
	}

	async resetSecurityConsent(): Promise<void> {
		await this.securityMiddleware.reset();
	}
}
