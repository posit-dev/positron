/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import express from 'express';
import { Server } from 'http';

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
	error?: {
		code: number;
		message: string;
	};
}

interface ForegroundSessionInfo {
	sessionId: string;
	sessionName: string;
	languageId: string;
	runtimeId: string;
	sessionMode: 'Console' | 'Notebook' | 'Other';
	state: string;
}

interface VariableStateInfo {
	name: string;
	type: string;
	value: string;
	size: number;
	kind: string;
	hasChildren: boolean;
	path: string[];
}

interface RuntimeVariableState {
	sessionId: string;
	variables: VariableStateInfo[];
	totalCount: number;
	isLoading: boolean;
}

export class McpServer implements vscode.Disposable {
	private app: express.Express;
	private server: Server | undefined;
	private readonly port = (() => {
		const DEFAULT_PORT = 43123;
		try {
			const raw = process.env.POSITRON_MCP_PORT;
			if (typeof raw !== 'string' || raw.trim().length === 0) {
				return DEFAULT_PORT;
			}
			const parsed = Number(raw);
			if (Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535) {
				return parsed;
			}
			console.warn(`Ignoring invalid POSITRON_MCP_PORT='${raw}'. Using default ${DEFAULT_PORT}.`);
			return DEFAULT_PORT;
		} catch (error) {
			console.warn('Failed to resolve POSITRON_MCP_PORT from environment. Using default 43123.', error);
			return DEFAULT_PORT;
		}
	})();

	constructor() {
		this.app = express();
		this.setupMiddleware();
		this.setupRoutes();
	}

	private setupMiddleware(): void {
		// Set CORS headers for browser clients
		this.app.use((_req, res, next) => {
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
			next();
		});

		// Parse JSON requests
		this.app.use(express.json());
	}

	private setupRoutes(): void {
		// Handle OPTIONS requests
		this.app.options('*', (_req, res) => {
			res.sendStatus(200);
		});

		// Main MCP endpoint
		this.app.post('/', (req, res) => {
			this.handleMcpRequest(req, res);
		});

		// Health check endpoint
		this.app.get('/health', (_req, res) => {
			res.json({ status: 'ok', server: 'positron-mcp-server' });
		});
	}

	private async handleMcpRequest(req: express.Request, res: express.Response): Promise<void> {
		try {
			const request: McpRequest = req.body;
			console.log(`MCP request: ${request.method}`);

			const response = await this.processRequest(request);
			res.json(response);
		} catch (error) {
			console.error('Error handling MCP request:', error);
			res.status(400).json({
				jsonrpc: '2.0',
				error: {
					code: -32700,
					message: 'Parse error'
				}
			});
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
						capabilities: {
							tools: {}
						},
						serverInfo: {
							name: 'positron-mcp-server',
							version: '1.0.0'
						}
					}
				};

			case 'tools/list':
				return {
					jsonrpc: '2.0',
					id: request.id,
					result: {
						tools: [
							{
								name: 'get-time',
								description: 'Get the current time in ISO format',
								inputSchema: {
									type: 'object',
									properties: {},
									additionalProperties: false
								}
							},
							{
								name: 'foreground-session',
								description: 'Get information about the current foreground language runtime session',
								inputSchema: {
									type: 'object',
									properties: {},
									additionalProperties: false
								}
							},
							{
								name: 'get-variables',
								description: 'Get the current variables state for the active runtime session',
								inputSchema: {
									type: 'object',
									properties: {},
									additionalProperties: false
								}
							}
						]
					}
				};

			case 'tools/call':
				return await this.handleToolCall(request);

			default:
				return {
					jsonrpc: '2.0',
					id: request.id,
					error: {
						code: -32601,
						message: 'Method not found'
					}
				};
		}
	}

	private async handleToolCall(request: McpRequest): Promise<McpResponse> {
		const toolName = request.params?.name;

		switch (toolName) {
			case 'get-time':
				return {
					jsonrpc: '2.0',
					id: request.id,
					result: {
						content: [
							{
								type: 'text',
								text: JSON.stringify({
									time: new Date().toISOString()
								})
							}
						]
					}
				};

			case 'foreground-session':
				try {
					const sessionInfo = await this.getForegroundSessionInfo();
					return {
						jsonrpc: '2.0',
						id: request.id,
						result: {
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										session: sessionInfo ?? null
									})
								}
							]
						}
					};
				} catch (error) {
					return {
						jsonrpc: '2.0',
						id: request.id,
						error: {
							code: -32603,
							message: `Failed to get foreground session: ${error}`
						}
					};
				}

			case 'get-variables':
				try {
					const variableState = await this.getCurrentVariableState();
					return {
						jsonrpc: '2.0',
						id: request.id,
						result: {
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										variableState: variableState ?? null
									})
								}
							]
						}
					};
				} catch (error) {
					return {
						jsonrpc: '2.0',
						id: request.id,
						error: {
							code: -32603,
							message: `Failed to get variables: ${error}`
						}
					};
				}

			default:
				return {
					jsonrpc: '2.0',
					id: request.id,
					error: {
						code: -32601,
						message: `Tool '${toolName}' not found`
					}
				};
		}
	}

	private async getForegroundSessionInfo(): Promise<ForegroundSessionInfo | undefined> {
		try {
			const session = await positron.runtime.getForegroundSession();
			if (!session) {
				return undefined;
			}

			return {
				sessionId: session.metadata.sessionId,
				sessionName: session.dynState.sessionName,
				languageId: session.runtimeMetadata.languageId,
				runtimeId: session.runtimeMetadata.runtimeId,
				sessionMode: session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console
					? 'Console'
					: session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Notebook
						? 'Notebook'
						: 'Other',
				state: session.dynState.currentState ?? 'Unknown'
			};
		} catch (error) {
			console.error('Failed to get foreground session info:', error);
			return undefined;
		}
	}

	private async getCurrentVariableState(): Promise<RuntimeVariableState | undefined> {
		try {
			const session = await positron.runtime.getForegroundSession();
			if (!session) {
				return undefined;
			}

			// Get all variables for the session
			const variablesData = await positron.runtime.getSessionVariables(session.metadata.sessionId);

			// Flatten the nested array structure and convert to our format
			const variables: VariableStateInfo[] = [];
			for (const variableGroup of variablesData) {
				for (const runtimeVar of variableGroup) {
					variables.push({
						name: runtimeVar.display_name,
						type: runtimeVar.display_type,
						value: runtimeVar.display_value,
						size: runtimeVar.size || 0,
						kind: runtimeVar.kind || 'unknown',
						hasChildren: runtimeVar.has_children || false,
						path: runtimeVar.access_key ? runtimeVar.access_key.split('.') : [runtimeVar.display_name]
					});
				}
			}

			return {
				sessionId: session.metadata.sessionId,
				variables,
				totalCount: variables.length,
				isLoading: false
			};
		} catch (error) {
			console.error('Failed to get current variable state:', error);
			return undefined;
		}
	}

	async start(): Promise<void> {
		if (this.server) {
			return;
		}

		return new Promise((resolve, reject) => {
			this.server = this.app.listen(this.port, 'localhost', (error?: Error) => {
				if (error) {
					console.error('Failed to start Positron MCP server:', error);
					reject(error);
				} else {
					console.log(`Positron MCP server started on http://localhost:${this.port}`);
					resolve();
				}
			});
		});
	}

	dispose(): void {
		if (this.server) {
			this.server.close();
			this.server = undefined;
			console.log('Positron MCP server stopped');
		}
	}
}
