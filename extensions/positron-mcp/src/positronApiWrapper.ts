/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import {
	PositronMcpApi,
	PositronRuntimeApi,
	PositronWindowApi,
	PositronEditorApi,
	PositronWorkspaceApi,
	ExecuteCodeOptions,
	ExecutionResult,
	RuntimeSession,
	Variable,
	QueryTableResult,
	DocumentInfo,
	SelectionInfo,
	WorkspaceFolder,
	Configuration,
	PlotRenderSettings,
	PreviewPanel,
	PreviewOptions,
	EditorContext
} from './positronApi';

/**
 * Implementation of the Positron MCP API wrapper.
 * This class provides controlled access to Positron functionality for MCP clients.
 */
export class PositronApiWrapper implements PositronMcpApi {
	public readonly runtime: PositronRuntimeApi;
	public readonly window: PositronWindowApi;
	public readonly editor: PositronEditorApi;
	public readonly workspace: PositronWorkspaceApi;

	constructor(_context: vscode.ExtensionContext) {
		// Initialize runtime API
		this.runtime = {
			getForegroundSession: async (): Promise<RuntimeSession | undefined> => {
				try {
					const session = await positron.runtime.getForegroundSession();
					if (!session) {
						return undefined;
					}

					return this.convertToRuntimeSession(session);
				} catch (error) {
					console.error('Failed to get foreground session:', error);
					return undefined;
				}
			},

			getActiveSessions: async (): Promise<RuntimeSession[]> => {
				try {
					const sessions = await positron.runtime.getActiveSessions();
					return sessions.map(s => this.convertToRuntimeSession(s));
				} catch (error) {
					console.error('Failed to get active sessions:', error);
					return [];
				}
			},

			selectLanguageRuntime: async (runtimeId: string): Promise<void> => {
				if (!runtimeId?.trim()) {
					throw new Error('runtimeId is required');
				}

				try {
					await positron.runtime.selectLanguageRuntime(runtimeId);
				} catch (error) {
					console.error('Failed to select language runtime:', error);
					throw error;
				}
			},

			startLanguageRuntime: async (runtimeId: string, sessionName: string, notebookUri?: vscode.Uri): Promise<RuntimeSession> => {
				if (!runtimeId?.trim()) {
					throw new Error('runtimeId is required');
				}
				if (!sessionName?.trim()) {
					throw new Error('sessionName is required');
				}

				try {
					const session = await positron.runtime.startLanguageRuntime(
						runtimeId,
						sessionName,
						notebookUri
					);
					return this.convertToRuntimeSession(session);
				} catch (error) {
					console.error('Failed to start language runtime:', error);
					throw error;
				}
			},

			restartSession: async (sessionId: string): Promise<void> => {
				if (!sessionId?.trim()) {
					throw new Error('sessionId is required');
				}

				try {
					await positron.runtime.restartSession(sessionId);
				} catch (error) {
					console.error('Failed to restart session:', error);
					throw error;
				}
			},

			focusSession: (sessionId: string): void => {
				if (!sessionId?.trim()) {
					throw new Error('sessionId is required');
				}

				try {
					positron.runtime.focusSession(sessionId);
				} catch (error) {
					console.error('Failed to focus session:', error);
					throw error;
				}
			},

			executeCode: async (languageId: string, code: string, options: ExecuteCodeOptions = {}): Promise<ExecutionResult> => {
				// Input validation
				if (!languageId?.trim()) {
					throw new Error('languageId is required');
				}
				if (!code?.trim()) {
					throw new Error('code is required');
				}

				try {
					const {
						focus = false,
						allowIncomplete = false,
						mode = 'interactive',
						errorBehavior = 'stop',
						observer
					} = options;

					// Convert mode string to enum
					const executionMode = this.parseExecutionMode(mode);
					const errorMode = errorBehavior === 'continue'
						? positron.RuntimeErrorBehavior.Continue
						: positron.RuntimeErrorBehavior.Stop;

					// Execute with observer if provided
					if (observer) {
						const result = await positron.runtime.executeCode(
							languageId,
							code,
							focus,
							allowIncomplete,
							executionMode,
							errorMode,
							observer as any
						);

						return {
							success: true,
							data: result,
							metadata: {
								timestamp: new Date().toISOString()
							}
						};
					}

					// Execute without observer
					const result = await positron.runtime.executeCode(
						languageId,
						code,
						focus,
						allowIncomplete,
						executionMode,
						errorMode
					);

					return {
						success: true,
						data: result,
						metadata: {
							timestamp: new Date().toISOString()
						}
					};
				} catch (error) {
					return {
						success: false,
						error: {
							name: error instanceof Error ? error.name : 'Error',
							message: error instanceof Error ? error.message : String(error),
							traceback: error instanceof Error && 'stack' in error ? [error.stack!] : []
						}
					};
				}
			},

			getSessionVariables: async (sessionId: string, accessKeys?: string[][]): Promise<Variable[]> => {
				if (!sessionId?.trim()) {
					throw new Error('sessionId is required');
				}

				try {
					const variableGroups = await positron.runtime.getSessionVariables(sessionId, accessKeys);
					// Flatten the variable groups into a single array
					const variables: Variable[] = [];
					for (const group of variableGroups) {
						for (const variable of group) {
							variables.push({
								name: variable.display_name,
								type: variable.display_type || '',
								value: variable.display_value || '',
								size: variable.size,
								kind: (variable as any).kind || 'unknown',
								hasChildren: variable.has_children,
								path: variable.access_key ? [variable.access_key] : []
							});
						}
					}
					return variables;
				} catch (error) {
					console.error('Failed to get session variables:', error);
					return [];
				}
			},

			querySessionTables: async (sessionId: string, accessKeys: string[][], queryTypes: string[]): Promise<QueryTableResult[]> => {
				if (!sessionId?.trim()) {
					throw new Error('sessionId is required');
				}

				try {
					const results = await positron.runtime.querySessionTables(sessionId, accessKeys, queryTypes);
					return results.map((result: any) => ({
						columns: result.columns || [],
						rows: result.rows || [],
						rowCount: result.row_count || 0
					}));
				} catch (error) {
					console.error('Failed to query session tables:', error);
					return [];
				}
			},

			onDidExecuteCode: positron.runtime.onDidExecuteCode as any,
			onDidChangeForegroundSession: positron.runtime.onDidChangeForegroundSession as any,
			onDidRegisterRuntime: positron.runtime.onDidRegisterRuntime as any
		};

		// Initialize window API
		this.window = {
			getConsoleForLanguage: async (languageId: string) => {
				if (!languageId?.trim()) {
					throw new Error('languageId is required');
				}

				try {
					const console = await positron.window.getConsoleForLanguage(languageId);
					if (!console) {
						return undefined;
					}

					// The positron console returns a different structure
					return {
						id: languageId,
						languageId: languageId,
						width: 80,
						height: 25
					};
				} catch (error) {
					console.error('Failed to get console for language:', error);
					return undefined;
				}
			},

			getConsoleWidth: async (): Promise<number> => {
				try {
					return await positron.window.getConsoleWidth();
				} catch (error) {
					console.error('Failed to get console width:', error);
					return 80; // Default fallback
				}
			},

			onDidChangeConsoleWidth: positron.window.onDidChangeConsoleWidth,

			getPlotsRenderSettings: async (): Promise<PlotRenderSettings> => {
				try {
					const settings: any = await positron.window.getPlotsRenderSettings();
					return {
						width: settings.width || 800,
						height: settings.height || 600,
						pixelRatio: settings.pixel_ratio || settings.pixelRatio || 1,
						format: (settings.format || 'png') as 'png' | 'svg' | 'jpeg'
					};
				} catch (error) {
					console.error('Failed to get plots render settings:', error);
					// Return sensible defaults
					return {
						width: 800,
						height: 600,
						pixelRatio: 1,
						format: 'png'
					};
				}
			},

			onDidChangePlotsRenderSettings: positron.window.onDidChangePlotsRenderSettings as any,

			showSimpleModalDialogPrompt: async (title: string, message: string, okButton?: string, cancelButton?: string): Promise<boolean> => {
				try {
					return await positron.window.showSimpleModalDialogPrompt(title, message, okButton, cancelButton);
				} catch (error) {
					console.error('Failed to show modal dialog prompt:', error);
					return false;
				}
			},

			showSimpleModalDialogMessage: async (title: string, message: string, okButton?: string): Promise<void> => {
				try {
					await positron.window.showSimpleModalDialogMessage(title, message, okButton);
				} catch (error) {
					console.error('Failed to show modal dialog message:', error);
				}
			},

			createPreviewPanel: (viewType: string, title: string, preserveFocus?: boolean, _options?: PreviewOptions): PreviewPanel => {
				const panel = positron.window.createPreviewPanel(viewType, title, preserveFocus);

				return {
					viewType: panel.viewType,
					title: panel.title,
					webview: panel.webview,
					visible: panel.visible,
					reveal: (_column?: vscode.ViewColumn, _preserveFocus?: boolean) => {
						panel.reveal();
					},
					dispose: () => {
						panel.dispose();
					}
				};
			},

			previewUrl: (url: vscode.Uri): PreviewPanel => {
				const panel = positron.window.previewUrl(url);
				return {
					viewType: 'url-preview',
					title: 'URL Preview',
					webview: panel.webview,
					visible: panel.visible,
					reveal: (_column?: vscode.ViewColumn, _preserveFocus?: boolean) => {
						panel.reveal();
					},
					dispose: () => {
						panel.dispose();
					}
				};
			},

			previewHtml: (path: string): PreviewPanel => {
				const panel = positron.window.previewHtml(path);
				return {
					viewType: 'html-preview',
					title: 'HTML Preview',
					webview: panel.webview,
					visible: panel.visible,
					reveal: (_column?: vscode.ViewColumn, _preserveFocus?: boolean) => {
						panel.reveal();
					},
					dispose: () => {
						panel.dispose();
					}
				};
			}
		};

		// Initialize editor API
		this.editor = {
			getActiveDocument: async (): Promise<DocumentInfo | undefined> => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					return undefined;
				}

				return {
					uri: editor.document.uri.toString(),
					languageId: editor.document.languageId,
					fileName: editor.document.fileName,
					isUntitled: editor.document.isUntitled,
					isDirty: editor.document.isDirty,
					lineCount: editor.document.lineCount,
					content: editor.document.getText()
				};
			},

			getSelection: async (): Promise<SelectionInfo | undefined> => {
				const editor = vscode.window.activeTextEditor;
				if (!editor || editor.selection.isEmpty) {
					return undefined;
				}

				return {
					text: editor.document.getText(editor.selection),
					range: {
						start: {
							line: editor.selection.start.line,
							character: editor.selection.start.character
						},
						end: {
							line: editor.selection.end.line,
							character: editor.selection.end.character
						}
					}
				};
			},

			getVisibleRanges: async (): Promise<vscode.Range[]> => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					return [];
				}

				return [...editor.visibleRanges];
			},

			getLastActiveEditorContext: async (): Promise<EditorContext | null> => {
				try {
					// This uses positron.methods if available
					if ('methods' in positron && 'getLastActiveEditorContext' in (positron as any).methods) {
						return await (positron as any).methods.getLastActiveEditorContext();
					}
					// Fallback to current editor
					const editor = vscode.window.activeTextEditor;
					if (!editor) {
						return null;
					}
					return {
						document: editor.document,
						selection: editor.selection,
						visibleRanges: [...editor.visibleRanges]
					};
				} catch (error) {
					console.error('Failed to get last active editor context:', error);
					return null;
				}
			},

			getDocumentText: async (uri: string, range?: vscode.Range): Promise<string> => {
				try {
					const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
					return range ? document.getText(range) : document.getText();
				} catch (error) {
					console.error('Failed to get document text:', error);
					throw error;
				}
			},

			insertText: async (uri: string, position: vscode.Position, text: string): Promise<void> => {
				try {
					const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
					const editor = await vscode.window.showTextDocument(document);
					await editor.edit(editBuilder => {
						editBuilder.insert(position, text);
					});
				} catch (error) {
					console.error('Failed to insert text:', error);
					throw error;
				}
			},

			replaceText: async (uri: string, range: vscode.Range, text: string): Promise<void> => {
				try {
					const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
					const editor = await vscode.window.showTextDocument(document);
					await editor.edit(editBuilder => {
						editBuilder.replace(range, text);
					});
				} catch (error) {
					console.error('Failed to replace text:', error);
					throw error;
				}
			}
		};

		// Initialize workspace API
		this.workspace = {
			getWorkspaceFolders: (): WorkspaceFolder[] => {
				return vscode.workspace.workspaceFolders?.map(folder => ({
					uri: folder.uri.toString(),
					name: folder.name,
					index: folder.index
				})) ?? [];
			},

			getWorkspaceConfiguration: (section?: string): Configuration => {
				const config = vscode.workspace.getConfiguration(section);
				return {
					get: <T>(key: string, defaultValue?: T) => config.get(key, defaultValue),
					has: (key: string) => config.has(key),
					inspect: <T>(key: string) => config.inspect<T>(key)
				};
			},

			readFile: async (uri: string): Promise<Uint8Array> => {
				try {
					return await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
				} catch (error) {
					console.error('Failed to read file:', error);
					throw error;
				}
			},

			writeFile: async (uri: string, content: Uint8Array): Promise<void> => {
				try {
					await vscode.workspace.fs.writeFile(vscode.Uri.parse(uri), content);
				} catch (error) {
					console.error('Failed to write file:', error);
					throw error;
				}
			},

			createFile: async (uri: string): Promise<void> => {
				try {
					await vscode.workspace.fs.writeFile(vscode.Uri.parse(uri), new Uint8Array());
				} catch (error) {
					console.error('Failed to create file:', error);
					throw error;
				}
			},

			deleteFile: async (uri: string): Promise<void> => {
				try {
					await vscode.workspace.fs.delete(vscode.Uri.parse(uri));
				} catch (error) {
					console.error('Failed to delete file:', error);
					throw error;
				}
			},

			findFiles: async (include: string, exclude?: string, maxResults?: number): Promise<vscode.Uri[]> => {
				try {
					return await vscode.workspace.findFiles(include, exclude, maxResults);
				} catch (error) {
					console.error('Failed to find files:', error);
					return [];
				}
			},

			openTextDocument: async (uri: string): Promise<vscode.TextDocument> => {
				try {
					return await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
				} catch (error) {
					console.error('Failed to open text document:', error);
					throw error;
				}
			}
		};
	}

	/**
	 * Utility method to convert execution mode string to enum
	 */
	private parseExecutionMode(mode: string): positron.RuntimeCodeExecutionMode {
		switch (mode) {
			case 'interactive':
				return positron.RuntimeCodeExecutionMode.Interactive;
			case 'non-interactive':
				return positron.RuntimeCodeExecutionMode.NonInteractive;
			case 'transient':
				return positron.RuntimeCodeExecutionMode.Transient;
			case 'silent':
				return positron.RuntimeCodeExecutionMode.Silent;
			default:
				return positron.RuntimeCodeExecutionMode.Interactive;
		}
	}

	/**
	 * Convert Positron runtime session to our API format
	 */
	private convertToRuntimeSession(session: any): RuntimeSession {
		return {
			metadata: {
				sessionId: session.metadata.sessionId,
				sessionName: session.metadata.sessionName || session.dynState.sessionName,
				sessionMode: session.metadata.sessionMode || 'Console',
				createTime: session.metadata.createTime || Date.now(),
				startTime: session.metadata.startTime,
				endTime: session.metadata.endTime,
				state: session.metadata.state || session.dynState.state || 'unknown',
				exitCode: session.metadata.exitCode
			},
			runtimeMetadata: {
				languageId: session.runtimeMetadata.languageId,
				languageName: session.runtimeMetadata.languageName,
				languageVersion: session.runtimeMetadata.languageVersion || '',
				runtimeId: session.runtimeMetadata.runtimeId,
				runtimeName: session.runtimeMetadata.runtimeName,
				runtimeVersion: session.runtimeMetadata.runtimeVersion || '',
				runtimePath: session.runtimeMetadata.runtimePath || ''
			},
			dynState: {
				sessionName: session.dynState.sessionName,
				workingDirectory: session.dynState.workingDirectory || '',
				busy: session.dynState.busy || false,
				hasShutdown: session.dynState.hasShutdown || false
			}
		};
	}
}