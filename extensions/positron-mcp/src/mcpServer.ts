/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import express, { Request, Response, NextFunction } from 'express';
import { Server } from 'node:http';
import { PositronMcpApi } from './positronApi';

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
	private readonly outputChannel: vscode.OutputChannel;
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
			return DEFAULT_PORT;
		} catch (error) {
			return DEFAULT_PORT;
		}
	})();

	constructor(private readonly api: PositronMcpApi) {
		this.outputChannel = vscode.window.createOutputChannel('Positron MCP Server');
		this.app = express();
		this.setupMiddleware();
		this.setupRoutes();
	}

	private setupMiddleware(): void {
		// Set CORS headers for browser clients
		this.app.use((_req: Request, res: Response, next: NextFunction) => {
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
		this.app.options('*', (_req: Request, res: Response) => {
			res.sendStatus(200);
		});

		// Main MCP endpoint
		this.app.post('/', (req: Request, res: Response) => {
			this.handleMcpRequest(req, res);
		});

		// Health check endpoint
		this.app.get('/health', (_req: Request, res: Response) => {
			res.json({ status: 'ok', server: 'positron-mcp-server' });
		});
	}

	private async handleMcpRequest(req: Request, res: Response): Promise<void> {
		try {
			const request: McpRequest = req.body;
			this.outputChannel.appendLine(`MCP request: ${request.method}`);

			const response = await this.processRequest(request);
			res.json(response);
		} catch (error) {
			this.outputChannel.appendLine(`Error handling MCP request: ${error}`);
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
								description: '📊 Get current runtime session - Returns active Python/R/JS console information',
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
							},
							{
								name: 'execute-code',
								description: 'Execute code in the active runtime session',
								inputSchema: {
									type: 'object',
									properties: {
										languageId: {
											type: 'string',
											description: 'Language identifier (python, r, etc.)',
											enum: ['python', 'r', 'javascript', 'typescript']
										},
										code: {
											type: 'string',
											description: 'Code to execute'
										},
										options: {
											type: 'object',
											properties: {
												focus: { type: 'boolean', default: false },
												mode: {
													type: 'string',
													enum: ['interactive', 'non-interactive', 'transient', 'silent'],
													default: 'interactive'
												},
												allowIncomplete: { type: 'boolean', default: false }
											}
										}
									},
									required: ['languageId', 'code']
								}
							},
							{
								name: 'get-active-document',
								description: 'Get information about the currently active document',
								inputSchema: {
									type: 'object',
									properties: {
										includeContent: { type: 'boolean', default: false },
										includeSelection: { type: 'boolean', default: true }
									}
								}
							},
							{
								name: 'get-workspace-info',
								description: 'Get comprehensive workspace information',
								inputSchema: {
									type: 'object',
									properties: {
										includeConfig: { type: 'boolean', default: true },
										configSection: { type: 'string' }
									}
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
					
					// Format the response in a more readable way
					let formattedText: string;
					if (sessionInfo) {
						formattedText = `Runtime Session: ${sessionInfo.sessionName}
Language: ${sessionInfo.languageId}
State: ${sessionInfo.state}
Mode: ${sessionInfo.sessionMode}
Session ID: ${sessionInfo.sessionId}`;
					} else {
						formattedText = 'No active runtime session';
					}
					
					return {
						jsonrpc: '2.0',
						id: request.id,
						result: {
							content: [
								{
									type: 'text',
									text: formattedText
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
					
					let formattedText: string;
					if (variableState && variableState.variables.length > 0) {
						const varLines = variableState.variables.map(v => {
							// Format the value more nicely
							let displayValue = v.value;
							if (displayValue.includes('DataFrame')) {
								// Extract dimensions if it's a DataFrame
								const match = displayValue.match(/\[(\d+) rows x (\d+) columns\]/);
								if (match) {
									displayValue = `DataFrame with ${match[1]} rows × ${match[2]} columns`;
								}
							} else if (displayValue.length > 50) {
								displayValue = displayValue.substring(0, 50) + '...';
							}
							
							return `• ${v.name} – ${v.type} ${displayValue ? `: ${displayValue}` : ''}`;
						});
						
						formattedText = `You have ${variableState.totalCount} variable${variableState.totalCount !== 1 ? 's' : ''} in your Python workspace:\n\n${varLines.join('\n')}`;
						
						// Add helpful context if there are DataFrames
						const dataframes = variableState.variables.filter(v => v.type.includes('DataFrame'));
						if (dataframes.length > 0) {
							const dfInfo = dataframes.map(df => {
								const match = df.value.match(/\[(\d+) rows x (\d+) columns\]/);
								if (match) {
									return `${df.name} (${match[1]} rows × ${match[2]} columns)`;
								}
								return df.name;
							});
							formattedText += `\n\nDataFrames: ${dfInfo.join(', ')}`;
						}
					} else if (variableState) {
						formattedText = 'No variables in your workspace yet';
					} else {
						formattedText = 'No active runtime session. Start a Python/R console to see variables.';
					}
					
					return {
						jsonrpc: '2.0',
						id: request.id,
						result: {
							content: [
								{
									type: 'text',
									text: formattedText
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

			case 'execute-code':
				try {
					const { languageId, code, options = {} } = request.params.arguments;
					const result = await this.api.runtime.executeCode(languageId, code, options);
					return {
						jsonrpc: '2.0',
						id: request.id,
						result: {
							content: [
								{
									type: 'text',
									text: JSON.stringify(result)
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
							message: `Code execution failed: ${error}`
						}
					};
				}

			case 'get-active-document':
				try {
					const { includeContent = false, includeSelection = true } = request.params?.arguments || {};
					const document = await this.api.editor.getActiveDocument();
					
					if (!document) {
						return {
							jsonrpc: '2.0',
							id: request.id,
							result: {
								content: [
									{
										type: 'text',
										text: JSON.stringify({ document: null, selection: null })
									}
								]
							}
						};
					}

					const result: any = {
						document: {
							uri: document.uri,
							languageId: document.languageId,
							fileName: document.fileName,
							lineCount: document.lineCount,
							isDirty: document.isDirty
						}
					};

					if (includeContent) {
						result.document.content = document.content;
					}

					if (includeSelection) {
						const selection = await this.api.editor.getSelection();
						result.selection = selection || null;
					}

					return {
						jsonrpc: '2.0',
						id: request.id,
						result: {
							content: [
								{
									type: 'text',
									text: JSON.stringify(result)
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
							message: `Failed to get active document: ${error}`
						}
					};
				}

			case 'get-workspace-info':
				try {
					const { includeConfig = true, configSection } = request.params?.arguments || {};
					
					const folders = this.api.workspace.getWorkspaceFolders();
					const activeSession = await this.api.runtime.getForegroundSession();
					const activeSessions = await this.api.runtime.getActiveSessions();

					const result: any = {
						folders,
						activeRuntimes: activeSessions.map(s => ({
							languageId: s.runtimeMetadata.languageId,
							sessionId: s.metadata.sessionId,
							sessionName: s.metadata.sessionName,
							isActive: activeSession?.metadata.sessionId === s.metadata.sessionId
						}))
					};

					if (includeConfig) {
						const config = this.api.workspace.getWorkspaceConfiguration(configSection);
						const configData: Record<string, any> = {};
						
						// Get some common configuration values
						if (configSection) {
							// Get all keys for the specific section
							const inspection = config.inspect('');
							if (inspection) {
								configData[configSection] = inspection;
							}
						} else {
							// Get some common settings
							configData['positron.mcp.enable'] = config.get('positron.mcp.enable');
						}
						
						result.configuration = configData;
					}

					return {
						jsonrpc: '2.0',
						id: request.id,
						result: {
							content: [
								{
									type: 'text',
									text: JSON.stringify(result)
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
							message: `Failed to get workspace info: ${error}`
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
			const session = await this.api.runtime.getForegroundSession();
			if (!session) {
				return undefined;
			}

			return {
				sessionId: session.metadata.sessionId,
				sessionName: session.metadata.sessionName,
				languageId: session.runtimeMetadata.languageId,
				runtimeId: session.runtimeMetadata.runtimeId,
				sessionMode: session.metadata.sessionMode as 'Console' | 'Notebook' | 'Other',
				state: session.metadata.state
			};
		} catch (error) {
			this.outputChannel.appendLine(`Failed to get foreground session info: ${error}`);
			return undefined;
		}
	}

	private async getCurrentVariableState(): Promise<RuntimeVariableState | undefined> {
		try {
			const session = await this.api.runtime.getForegroundSession();
			if (!session) {
				return undefined;
			}

			// Get all variables for the session
			const variablesData = await this.api.runtime.getSessionVariables(session.metadata.sessionId);

			// Convert to our format
			const variables: VariableStateInfo[] = variablesData.map(v => ({
				name: v.name,
				type: v.type,
				value: v.value,
				size: v.size || 0,
				kind: v.kind || 'unknown',
				hasChildren: v.hasChildren || false,
				path: v.path || [v.name]
			}));

			return {
				sessionId: session.metadata.sessionId,
				variables,
				totalCount: variables.length,
				isLoading: false
			};
		} catch (error) {
			this.outputChannel.appendLine(`Failed to get current variable state: ${error}`);
			return undefined;
		}
	}

	async start(): Promise<void> {
		if (this.server) {
			return;
		}

		return new Promise((resolve) => {
			this.server = this.app.listen(this.port, 'localhost', () => {
				this.outputChannel.appendLine(`Positron MCP server started on http://localhost:${this.port}`);
				resolve();
			});
		});
	}

	dispose(): void {
		if (this.server) {
			this.server.close();
			this.server = undefined;
			this.outputChannel.appendLine('Positron MCP server stopped');
		}
		this.outputChannel.dispose();
	}
}
