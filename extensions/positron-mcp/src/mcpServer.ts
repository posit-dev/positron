/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import express, { Request, Response } from 'express';
import { Server } from 'node:http';
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

/** One MCP tool: its advertised schema plus a handler returning the text payload. */
interface Tool {
	name: string;
	description: string;
	inputSchema: object;
	run: (args: any) => Promise<string>;
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

function parsePort(): number {
	const DEFAULT_PORT = 43123;
	const raw = process.env.POSITRON_MCP_PORT;
	if (!raw?.trim()) {
		return DEFAULT_PORT;
	}
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : DEFAULT_PORT;
}

function textResult(id: McpRequest['id'], text: string): McpResponse {
	return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
}

function errorResult(id: McpRequest['id'], code: number, message: string): McpResponse {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

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
			return textResult(request.id, await tool.run(request.params?.arguments ?? {}));
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
				description: 'Execute code in the active runtime session',
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

		const consented = await this.securityMiddleware.checkCodeExecutionConsent(languageId, code);
		if (!consented) {
			this.logger.warn('Security', 'Code execution denied by user');
			throw new ToolError(-32001, 'Code execution denied by user');
		}

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
