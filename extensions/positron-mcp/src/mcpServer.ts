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

/** A block of MCP tool-result content (the wire shape sent to the client). */
type McpContent =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string };

/**
 * MCP tool annotations: optional hints clients use to gate and parallelize
 * tool calls (e.g. auto-approving read-only tools, confirming destructive ones).
 */
interface ToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}

/** One MCP tool: its advertised schema plus a handler returning the result payload. */
interface Tool {
	name: string;
	description: string;
	inputSchema: object;
	annotations?: ToolAnnotations;
	run: (args: any) => Promise<string | McpContent[]>;
}

/** A tool failure that carries a specific JSON-RPC error code. */
class ToolError extends Error {
	constructor(readonly code: number, message: string) {
		super(message);
	}
}

/** A snapshot of the server's runtime state, for the status UI. */
export interface McpServerStatus {
	/** Whether the HTTP server is currently listening. */
	running: boolean;
	/** The port the server listens on. */
	port: number;
	/** Number of JSON-RPC requests handled since this window started the server. */
	requestCount: number;
	/** When the most recent request was handled, if any. */
	lastRequestAt?: Date;
	/** The client from the most recent `initialize` handshake, if any. */
	lastClient?: { name: string; version?: string };
}

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
const SERVER_INSTRUCTIONS = `These tools connect to a live Positron IDE session running Python and/or R that the user is working in interactively. For any data exploration or data modeling work -- finding, downloading, loading, cleaning, analyzing, plotting, or modeling data -- always do it inside Positron: run code with execute-code in the user's session (or in a notebook), and write scripts to files and open them with open-document so they stay visible. Never run Python or R in your own shell or spawn a separate interpreter to do the work yourself; that hides it from the user and loses the session's shared state. More generally, when a task involves running code, inspecting data, plotting, or editing notebooks, use these tools rather than your own shell or file-editing tools.

Running code: use execute-code to run code in the active session. Variables, imports, and loaded data persist across calls and are shared with the user -- do not spawn a separate interpreter. Use get-session to see the active language/session and get-variables to inspect what is defined. If no session is active, use session-start to begin one.

Plots: after running code that produces a plot, call get-plot to see the rendered image from the Plots pane.

Notebooks: use notebook-read, notebook-edit, notebook-run-cells, and notebook-create. Never read or hand-edit the .ipynb file or parse its JSON -- that corrupts notebook state. Cells are 0-indexed and indices shift after an insert or delete, so re-read before further edits.

Files: after writing a script or other file to disk, call open-document to open it in the user's editor so your work is visible to them.

Data: list variables with get-variables, then inspect-variable for a specific dataframe's columns and types, before writing code against it -- do not guess column names. Use get-packages to see which packages are installed instead of running pip list / installed.packages(). Use get-diagnostics for a file's errors/warnings, and session-interrupt / session-restart if the session hangs.`;

export class McpServer implements vscode.Disposable {
	private readonly app: express.Express;
	private server: Server | undefined;
	private readonly logger = getLogger();
	private readonly securityMiddleware: MinimalSecurityMiddleware;
	private readonly port = parsePort();
	private readonly tools: Tool[];
	private requestCount = 0;
	private lastRequestAt: Date | undefined;
	private lastClient: { name: string; version?: string } | undefined;

	constructor(context: vscode.ExtensionContext) {
		this.app = express();
		this.securityMiddleware = new MinimalSecurityMiddleware(loadSecurityConfig(), context);
		this.tools = this.buildTools();
		this.setupMiddleware();
		this.setupRoutes();
	}

	private setupMiddleware(): void {
		// JSON parsing must come before the security middleware that inspects the body.
		// Cap the body size at the configured maximum; Express's default is 100kb,
		// which would otherwise silently override the larger configured limit.
		const maxRequestSize = vscode.workspace.getConfiguration('positron.mcp.security').get<number>('maxRequestSize', 1048576);
		this.app.use(express.json({ limit: maxRequestSize }));
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
			// A JSON-RPC notification (no id) gets no response body; acknowledge with
			// 202 per the Streamable HTTP transport instead of returning an error.
			if (request.id === undefined) {
				res.status(202).end();
				return;
			}
			res.json(await this.processRequest(request));
		} catch (error) {
			this.logger.error('MCP.Handler', 'Error handling MCP request', error);
			res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } });
		}
	}

	/**
	 * Dispatch a single JSON-RPC request to its handler and return the response.
	 * This is the server's protocol entry point: `handleMcpRequest` calls it for
	 * each HTTP request, and tests drive it directly (no socket) to exercise the
	 * protocol and tool handlers in-process.
	 */
	async processRequest(request: McpRequest): Promise<McpResponse> {
		this.requestCount++;
		this.lastRequestAt = new Date();
		switch (request.method) {
			case 'initialize': {
				const clientInfo = request.params?.clientInfo;
				if (clientInfo?.name) {
					this.lastClient = { name: String(clientInfo.name), version: clientInfo.version ? String(clientInfo.version) : undefined };
				}
				return {
					jsonrpc: '2.0',
					id: request.id,
					result: {
						protocolVersion: '2025-06-18',
						capabilities: { tools: {} },
						serverInfo: { name: 'positron-mcp-server', version: '1.0.0' },
						instructions: SERVER_INSTRUCTIONS,
					},
				};
			}
			case 'tools/list':
				return {
					jsonrpc: '2.0',
					id: request.id,
					result: {
						tools: this.tools.map(({ name, description, inputSchema, annotations }) =>
							annotations ? { name, description, inputSchema, annotations } : { name, description, inputSchema }),
					},
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
				name: 'get-session',
				description: 'Get the active runtime session: its language, name, and ID. Call this first to learn which language (Python or R) is running before running code or inspecting variables.',
				inputSchema: empty,
				annotations: { readOnlyHint: true },
				run: () => this.describeSession(),
			},
			{
				name: 'get-variables',
				description: 'List the variables defined in the active runtime session with their types and values. Check this before writing code against a dataframe so you don\'t guess column names.',
				inputSchema: empty,
				annotations: { readOnlyHint: true },
				run: () => this.describeVariables(),
			},
			{
				name: 'inspect-variable',
				description: 'Inspect one variable in the active session in detail: its type and value, plus its children (for a dataframe, the columns and their types). Prefer this over running df.head() / df.dtypes, which mutates session state.',
				inputSchema: {
					type: 'object',
					properties: {
						name: { type: 'string', description: 'The display name of the variable to inspect, as shown by get-variables (e.g. "df").' },
					},
					required: ['name'],
					additionalProperties: false,
				},
				annotations: { readOnlyHint: true },
				run: (args) => this.inspectVariable(args),
			},
			{
				name: 'get-packages',
				description: 'List the packages installed in the active runtime session -- the same data shown in the Packages pane -- with each package\'s version and whether it is attached and/or outdated. Use this instead of running pip list / installed.packages() in the session.',
				inputSchema: empty,
				annotations: { readOnlyHint: true },
				run: () => this.describePackages(),
			},
			{
				name: 'execute-code',
				description: 'Execute code in the active runtime session. Runs in the user\'s live, shared session, so variables and imports persist across calls; prefer this over spawning a separate interpreter. Call get-session first to confirm the active language.',
				inputSchema: {
					type: 'object',
					properties: {
						languageId: { type: 'string', description: 'Language of the active session.', enum: ['python', 'r'] },
						code: { type: 'string', description: 'Code to execute.' },
					},
					required: ['languageId', 'code'],
					additionalProperties: false,
				},
				annotations: { readOnlyHint: false, openWorldHint: true },
				run: (args) => this.executeCodeTool(args),
			},
			{
				name: 'get-active-document',
				description: 'Get information about the editor document the user is currently focused on: its path, language, and optionally its content or selected text.',
				inputSchema: {
					type: 'object',
					properties: {
						includeContent: { type: 'boolean', default: false, description: 'Include the full document text.' },
						includeSelection: { type: 'boolean', default: true, description: 'Include the currently selected text and its range.' },
					},
					additionalProperties: false,
				},
				annotations: { readOnlyHint: true },
				run: async (args) => JSON.stringify(this.describeActiveDocument(args)),
			},
			{
				name: 'open-document',
				description: 'Open a file in the Positron editor so the user can see it. Use this after writing or modifying a script file to bring it up in front of the user.',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'Absolute path, or a path relative to the first workspace folder.' },
					},
					required: ['path'],
					additionalProperties: false,
				},
				annotations: { readOnlyHint: false },
				run: (args) => this.openDocument(args),
			},
			{
				name: 'get-workspace-info',
				description: 'List the workspace folders (project roots) open in Positron. Use to resolve relative paths and understand the project layout.',
				inputSchema: empty,
				annotations: { readOnlyHint: true },
				run: async () => JSON.stringify(this.describeWorkspace()),
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
					additionalProperties: false,
				},
				annotations: { readOnlyHint: true },
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
					additionalProperties: false,
				},
				annotations: { readOnlyHint: false },
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
					additionalProperties: false,
				},
				annotations: { readOnlyHint: false },
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
					additionalProperties: false,
				},
				annotations: { readOnlyHint: false },
				run: (args) => this.createNotebook(args),
			},
			{
				name: 'get-plot',
				description: 'Get the plot currently shown in the Positron Plots pane as an image. Run plotting code with execute-code first, then call this to see the result.',
				inputSchema: empty,
				annotations: { readOnlyHint: true },
				run: () => this.getPlot(),
			},
			{
				name: 'enlarge-plots-pane',
				description: 'Focus and enlarge the Positron Plots pane so plots render at a usable size. If a plot looks squished in a small pane, call this and then re-run the plotting code so it re-renders larger.',
				inputSchema: empty,
				annotations: { readOnlyHint: false },
				run: () => this.enlargePlotsPane(),
			},
			{
				name: 'session-start',
				description: 'Start a runtime session for a language when none is active. Use this when another tool reports "No active runtime session". If a session for the language is already running, it is left as-is.',
				inputSchema: {
					type: 'object',
					properties: {
						language: { type: 'string', enum: ['python', 'r'], description: 'The language to start a session for.' },
					},
					required: ['language'],
					additionalProperties: false,
				},
				annotations: { readOnlyHint: false },
				run: (args) => this.startSession(args),
			},
			{
				name: 'session-interrupt',
				description: 'Interrupt the active runtime session to stop a long-running or stuck computation.',
				inputSchema: empty,
				annotations: { readOnlyHint: false },
				run: () => this.interruptActiveSession(),
			},
			{
				name: 'session-restart',
				description: 'Restart the active runtime session. This clears all variables and loaded data; the user is asked to confirm first.',
				inputSchema: empty,
				annotations: { readOnlyHint: false, destructiveHint: true },
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
					additionalProperties: false,
				},
				annotations: { readOnlyHint: true },
				run: (args) => this.getDiagnostics(args),
			},
		];
	}

	private async describeSession(): Promise<string> {
		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			return 'No active runtime session. Use session-start to begin one.';
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

		const languageName = session.runtimeMetadata.languageName;
		let text = `You have ${variables.length} variable${variables.length !== 1 ? 's' : ''} in your ${languageName} workspace:\n\n${lines.join('\n')}`;

		const dataframes = variables.filter(v => v.type.includes('DataFrame'));
		if (dataframes.length > 0) {
			const info = dataframes.map(df => {
				const match = df.value.match(/\[(\d+) rows x (\d+) columns\]/);
				return match ? `${df.name} (${match[1]} rows × ${match[2]} columns)` : df.name;
			});
			text += `\n\nDataFrames: ${info.join(', ')}`;
		}
		return truncateOutput(text);
	}

	private async describePackages(): Promise<string> {
		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			return 'No active runtime session. Start a Python/R console first.';
		}

		// getSessionPackages queries the kernel, and that query queues behind any
		// running computation on the session's single-threaded kernel, so race it
		// against a timeout rather than let the tool call hang indefinitely on a
		// busy session. Settle to {ok}/{error} so the abandoned promise never
		// rejects unhandled after a timeout.
		const timeoutMs = vscode.workspace.getConfiguration('positron.mcp').get<number>('executionTimeout', 30000);
		const query = positron.runtime.getSessionPackages(session.metadata.sessionId).then(
			(packages): { ok: true; packages: positron.LanguageRuntimePackage[] } => ({ ok: true, packages }),
			(error): { ok: false; error: unknown } => ({ ok: false, error }),
		);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<'timeout'>((resolve) => {
			timer = setTimeout(() => resolve('timeout'), timeoutMs);
		});

		let outcome: 'timeout' | { ok: true; packages: positron.LanguageRuntimePackage[] } | { ok: false; error: unknown };
		try {
			outcome = await Promise.race([query, timeout]);
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
		}

		if (outcome === 'timeout') {
			return `Listing packages timed out after ${timeoutMs} ms; the session may be busy running code. Wait for it to finish, or call session-interrupt, then try again.`;
		}
		if (!outcome.ok) {
			// The runtime may not support package management.
			return `Could not list packages for this session: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`;
		}
		const packages = outcome.packages;

		if (packages.length === 0) {
			return 'No packages reported for the active session.';
		}

		const languageName = session.runtimeMetadata.languageName;
		const sorted = [...packages].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
		const lines = sorted.map(pkg => {
			const flags: string[] = [];
			if (pkg.attached) {
				flags.push('attached');
			}
			if (pkg.outdated) {
				flags.push(pkg.latestVersion ? `outdated -> ${pkg.latestVersion}` : 'outdated');
			}
			const suffix = flags.length ? ` (${flags.join(', ')})` : '';
			return `• ${pkg.name} ${pkg.version}${suffix}`;
		});
		return truncateOutput(`${packages.length} packages installed in your ${languageName} session:\n\n${lines.join('\n')}`);
	}

	private async inspectVariable(args: { name: string }): Promise<string> {
		const { name } = args;
		if (!name?.trim()) {
			throw new Error('name is required');
		}

		const session = await positron.runtime.getForegroundSession();
		if (!session) {
			return 'No active runtime session. Start a Python/R console first.';
		}

		const groups = await positron.runtime.getSessionVariables(session.metadata.sessionId);
		const variable = groups.flat().find(v => v.display_name === name);
		if (!variable) {
			return `No variable named "${name}" in the active session. Use get-variables to list what is defined.`;
		}

		const lines = [
			`${variable.display_name}: ${variable.display_type}`,
			variable.type_info ? `Class: ${variable.type_info}` : undefined,
			`Value: ${variable.display_value}`,
			`Length: ${variable.length}`,
		].filter((line): line is string => line !== undefined);

		if (variable.has_children) {
			// Drill one level into the variable via its access key. For a dataframe
			// this returns the columns; for an object, its fields/attributes.
			const childGroups = await positron.runtime.getSessionVariables(session.metadata.sessionId, [[variable.access_key]]);
			const children = childGroups[0] ?? [];
			lines.push('', `Children (${children.length}):`);
			for (const child of children) {
				const value = child.display_value.length > 80 ? child.display_value.slice(0, 80) + '...' : child.display_value;
				lines.push(`  ${child.display_name} - ${child.display_type}${value ? ` : ${value}` : ''}`);
			}
		}
		return truncateOutput(lines.join('\n'));
	}

	private async executeCodeTool(args: { languageId: string; code: string }): Promise<string> {
		const { languageId, code } = args;

		if (!languageId?.trim()) {
			throw new Error('languageId is required');
		}
		if (!code?.trim()) {
			throw new Error('code is required');
		}

		await this.requireExecutionConsent(languageId, code);

		const executionMode = positron.RuntimeCodeExecutionMode.Interactive;
		const errorMode = positron.RuntimeErrorBehavior.Stop;

		// We submit whole blocks, not lines typed into a REPL, so bypass the
		// console's interactive completeness check by passing allowIncomplete=true
		// below. With it left off (false), a multi-line block that happens to end on
		// an indented line -- a function or loop body, which the kernel's is_complete
		// check reports as "incomplete" -- is silently stashed as pending console
		// input and never run, so this promise would hang until the timeout. With it
		// on, the code is always sent to the kernel; genuinely incomplete code comes
		// back as a normal syntax error the model can fix, rather than a hang.
		//
		// The timeout below still guards against a legitimately long-running or
		// queued execution that never settles.
		const timeoutMs = vscode.workspace.getConfiguration('positron.mcp').get<number>('executionTimeout', 30000);
		const cts = new vscode.CancellationTokenSource();
		let started = false;
		let streamed = '';
		const observer: positron.runtime.ExecutionObserver = {
			token: cts.token,
			onStarted: () => { started = true; },
			onOutput: (message) => { streamed += message; },
			onError: (message) => { streamed += message; },
		};

		// Settle to {ok}/{error} so the abandoned promise never rejects unhandled
		// after a timeout.
		const execution = positron.runtime.executeCode(languageId, code, false, true, executionMode, errorMode, observer)
			.then(
				(data): { ok: true; data: Record<string, any> } => ({ ok: true, data }),
				(error): { ok: false; error: unknown } => ({ ok: false, error }),
			);

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<'timeout'>((resolve) => {
			timer = setTimeout(() => resolve('timeout'), timeoutMs);
		});

		try {
			const outcome = await Promise.race([execution, timeout]);

			if (outcome === 'timeout') {
				// Abandon this attempt; do not interrupt anything already running.
				cts.cancel();
				const message = started
					? `Code is still running after ${timeoutMs} ms. It may be a long computation -- wait and re-check with get-variables, or call session-interrupt to stop it.`
					: `Execution did not start within ${timeoutMs} ms, most likely because a previous statement is still running and this one is queued behind it. Wait and re-check with get-variables, or call session-interrupt to clear the running statement.`;
				return truncateOutput(JSON.stringify({ success: false, timedOut: true, started, partialOutput: streamed || undefined, error: { message } }));
			}

			if (outcome.ok) {
				return truncateOutput(JSON.stringify({ success: true, data: outcome.data, metadata: { timestamp: new Date().toISOString() } }));
			}
			const error = outcome.error;
			return truncateOutput(JSON.stringify({
				success: false,
				error: {
					name: error instanceof Error ? error.name : 'Error',
					message: error instanceof Error ? error.message : String(error),
					traceback: error instanceof Error && error.stack ? [error.stack] : [],
				},
			}));
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
			cts.dispose();
		}
	}

	/** Resolve a user-supplied path (absolute, or relative to the first workspace folder) to a URI. */
	private resolveWorkspacePath(inputPath: string): vscode.Uri {
		if (path.isAbsolute(inputPath)) {
			return vscode.Uri.file(inputPath);
		}
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new ToolError(-32602, 'No workspace folder is open; provide an absolute path.');
		}
		return vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, inputPath));
	}

	private async openDocument(args: { path: string }): Promise<string> {
		const { path: inputPath } = args;
		if (!inputPath?.trim()) {
			throw new Error('path is required');
		}
		const uri = this.resolveWorkspacePath(inputPath);
		try {
			await vscode.window.showTextDocument(uri, { preview: false });
		} catch (error) {
			throw new ToolError(-32603, `Failed to open ${inputPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
		return `Opened ${uri.fsPath} in the editor.`;
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

	private describeWorkspace(): object {
		const folders = (vscode.workspace.workspaceFolders ?? []).map(f => ({ uri: f.uri.toString(), name: f.name, index: f.index }));
		return { folders };
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

	private async enlargePlotsPane(): Promise<string> {
		// Reveal the Plots view, then grow it with the workbench view-size command.
		// The API exposes no absolute pane sizing, so this is a coarse, stepwise enlarge.
		await vscode.commands.executeCommand('workbench.panel.positronPlots.focus');
		for (let i = 0; i < 6; i++) {
			await vscode.commands.executeCommand('workbench.action.increaseViewSize');
		}
		return 'Focused and enlarged the Plots pane. Re-run your plotting code so the plot re-renders at the larger size.';
	}

	private async startSession(args: { language: string }): Promise<string> {
		const { language } = args;
		if (!language?.trim()) {
			throw new Error('language is required');
		}

		// If a session for this language is already active, leave it alone --
		// selecting a runtime shuts the existing one down and wipes its state.
		const sessions = await positron.runtime.getActiveSessions();
		const existing = sessions.find(s => s.runtimeMetadata.languageId === language);
		if (existing) {
			const dynState = await existing.getDynState();
			return `A ${language} session (${dynState.sessionName}) is already running.`;
		}

		const runtime = await positron.runtime.getPreferredRuntime(language);
		if (!runtime) {
			return `No ${language} runtime is registered in Positron.`;
		}

		await positron.runtime.selectLanguageRuntime(runtime.runtimeId);
		return `Starting ${runtime.runtimeName}. The session is initializing; give it a moment before running code.`;
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
				// Clear the handle so a later dispose() doesn't close a server that
				// never finished listening.
				this.server = undefined;
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

	getStatus(): McpServerStatus {
		return {
			running: this.server !== undefined,
			port: this.port,
			requestCount: this.requestCount,
			lastRequestAt: this.lastRequestAt,
			lastClient: this.lastClient,
		};
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
