/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Comprehensive interface for Positron MCP API access.
 * This interface defines the complete surface area we intend to expose
 * to MCP clients for AI interaction with Positron.
 */
export interface PositronMcpApi {
	/**
	 * Runtime management and code execution APIs
	 */
	runtime: PositronRuntimeApi;

	/**
	 * Window, console, and UI interaction APIs
	 */
	window: PositronWindowApi;

	/**
	 * Editor and document manipulation APIs
	 */
	editor: PositronEditorApi;

	/**
	 * Workspace and file system APIs
	 */
	workspace: PositronWorkspaceApi;

	/**
	 * Language services and analysis APIs
	 */
	languages?: PositronLanguagesApi; // Optional - Phase 3

	/**
	 * AI and chat integration APIs
	 */
	ai?: PositronAiApi; // Optional - Phase 3

	/**
	 * Connection and environment APIs
	 */
	connections?: PositronConnectionsApi; // Optional - Phase 3
	environment?: PositronEnvironmentApi; // Optional - Phase 3
}

/**
 * Runtime management and code execution
 */
export interface PositronRuntimeApi {
	/**
	 * Get the currently active foreground runtime session
	 * @returns Promise resolving to the active session or undefined if none
	 */
	getForegroundSession(): Promise<RuntimeSession | undefined>;

	/**
	 * Get all currently active runtime sessions
	 * @returns Promise resolving to array of active sessions
	 */
	getActiveSessions(): Promise<RuntimeSession[]>;

	/**
	 * Select a language runtime
	 * @param runtimeId - Runtime identifier
	 */
	selectLanguageRuntime(runtimeId: string): Promise<void>;

	/**
	 * Start a new language runtime session
	 * @param runtimeId - Runtime identifier
	 * @param sessionName - Name for the new session
	 * @param notebookUri - Optional notebook URI
	 */
	startLanguageRuntime(runtimeId: string, sessionName: string, notebookUri?: vscode.Uri): Promise<RuntimeSession>;

	/**
	 * Restart an existing session
	 * @param sessionId - Session to restart
	 */
	restartSession(sessionId: string): Promise<void>;

	/**
	 * Focus a specific session
	 * @param sessionId - Session to focus
	 */
	focusSession(sessionId: string): void;

	/**
	 * Execute code in a language runtime
	 * @param languageId - Language identifier (e.g., 'python', 'r')
	 * @param code - Code to execute
	 * @param options - Execution options
	 * @returns Promise resolving to execution result
	 */
	executeCode(languageId: string, code: string, options?: ExecuteCodeOptions): Promise<ExecutionResult>;

	/**
	 * Get variables from a runtime session
	 * @param sessionId - Target session ID
	 * @param accessKeys - Optional variable access keys to filter results
	 * @returns Promise resolving to array of variables
	 */
	getSessionVariables(sessionId: string, accessKeys?: string[][]): Promise<Variable[]>;

	/**
	 * Query session tables
	 * @param sessionId - Target session ID
	 * @param accessKeys - Variable access keys
	 * @param queryTypes - Types of queries to perform
	 */
	querySessionTables(sessionId: string, accessKeys: string[][], queryTypes: string[]): Promise<QueryTableResult[]>;

	/**
	 * Event fired when code is executed in any runtime
	 */
	readonly onDidExecuteCode: vscode.Event<CodeExecutionEvent>;

	/**
	 * Event fired when the foreground session changes
	 */
	readonly onDidChangeForegroundSession: vscode.Event<string | undefined>;

	/**
	 * Event fired when a runtime is registered
	 */
	readonly onDidRegisterRuntime: vscode.Event<LanguageRuntimeMetadata>;
}

/**
 * Window and UI interaction APIs
 */
export interface PositronWindowApi {
	/**
	 * Get console for a specific language
	 * @param languageId - Language identifier
	 */
	getConsoleForLanguage(languageId: string): Promise<Console | undefined>;

	/**
	 * Get the current console width
	 */
	getConsoleWidth(): Promise<number>;

	/**
	 * Event fired when console width changes
	 */
	readonly onDidChangeConsoleWidth: vscode.Event<number>;

	/**
	 * Get plot render settings
	 */
	getPlotsRenderSettings(): Promise<PlotRenderSettings>;

	/**
	 * Event fired when plot render settings change
	 */
	readonly onDidChangePlotsRenderSettings: vscode.Event<PlotRenderSettings>;

	/**
	 * Show a simple modal dialog with OK/Cancel
	 * @param title - Dialog title
	 * @param message - Dialog message
	 * @param okButton - OK button text
	 * @param cancelButton - Cancel button text
	 */
	showSimpleModalDialogPrompt(title: string, message: string, okButton?: string, cancelButton?: string): Promise<boolean>;

	/**
	 * Show a simple modal dialog with OK only
	 * @param title - Dialog title
	 * @param message - Dialog message
	 * @param okButton - OK button text
	 */
	showSimpleModalDialogMessage(title: string, message: string, okButton?: string): Promise<void>;

	/**
	 * Create a preview panel
	 * @param viewType - View type identifier
	 * @param title - Panel title
	 * @param preserveFocus - Whether to preserve focus
	 * @param options - Preview options
	 */
	createPreviewPanel(viewType: string, title: string, preserveFocus?: boolean, options?: PreviewOptions): PreviewPanel;

	/**
	 * Preview a URL
	 * @param url - URL to preview
	 */
	previewUrl(url: vscode.Uri): PreviewPanel;

	/**
	 * Preview HTML content
	 * @param path - Path to HTML file
	 */
	previewHtml(path: string): PreviewPanel;
}

/**
 * Editor and document manipulation APIs
 */
export interface PositronEditorApi {
	/**
	 * Get information about the active document
	 */
	getActiveDocument(): Promise<DocumentInfo | undefined>;

	/**
	 * Get current selection
	 */
	getSelection(): Promise<SelectionInfo | undefined>;

	/**
	 * Get visible ranges in the editor
	 */
	getVisibleRanges(): Promise<vscode.Range[]>;

	/**
	 * Get last active editor context
	 */
	getLastActiveEditorContext(): Promise<EditorContext | null>;

	/**
	 * Get document text
	 * @param uri - Document URI
	 * @param range - Optional range to get text from
	 */
	getDocumentText(uri: string, range?: vscode.Range): Promise<string>;

	/**
	 * Insert text at position
	 * @param uri - Document URI
	 * @param position - Insert position
	 * @param text - Text to insert
	 */
	insertText(uri: string, position: vscode.Position, text: string): Promise<void>;

	/**
	 * Replace text in range
	 * @param uri - Document URI
	 * @param range - Range to replace
	 * @param text - New text
	 */
	replaceText(uri: string, range: vscode.Range, text: string): Promise<void>;
}

/**
 * Workspace and file system APIs
 */
export interface PositronWorkspaceApi {
	/**
	 * Get workspace folders
	 */
	getWorkspaceFolders(): WorkspaceFolder[];

	/**
	 * Get workspace configuration
	 * @param section - Configuration section
	 */
	getWorkspaceConfiguration(section?: string): Configuration;

	/**
	 * Read file contents
	 * @param uri - File URI
	 */
	readFile(uri: string): Promise<Uint8Array>;

	/**
	 * Write file contents
	 * @param uri - File URI
	 * @param content - File content
	 */
	writeFile(uri: string, content: Uint8Array): Promise<void>;

	/**
	 * Create a new file
	 * @param uri - File URI
	 */
	createFile(uri: string): Promise<void>;

	/**
	 * Delete a file
	 * @param uri - File URI
	 */
	deleteFile(uri: string): Promise<void>;

	/**
	 * Find files in workspace
	 * @param include - Include pattern
	 * @param exclude - Exclude pattern
	 * @param maxResults - Maximum results
	 */
	findFiles(include: string, exclude?: string, maxResults?: number): Promise<vscode.Uri[]>;

	/**
	 * Open a text document
	 * @param uri - Document URI
	 */
	openTextDocument(uri: string): Promise<vscode.TextDocument>;
}

/**
 * Language services APIs (Phase 3)
 */
export interface PositronLanguagesApi {
	/**
	 * Get statement range at position
	 * @param uri - Document URI
	 * @param position - Position
	 */
	getStatementRange(uri: string, position: vscode.Position): Promise<StatementRange | undefined>;

	/**
	 * Get help topic at position
	 * @param uri - Document URI
	 * @param position - Position
	 */
	getHelpTopic(uri: string, position: vscode.Position): Promise<string | undefined>;

	/**
	 * Get document symbols
	 * @param uri - Document URI
	 */
	getDocumentSymbols(uri: string): Promise<vscode.DocumentSymbol[]>;

	/**
	 * Get definition locations
	 * @param uri - Document URI
	 * @param position - Position
	 */
	getDefinition(uri: string, position: vscode.Position): Promise<vscode.Location[]>;

	/**
	 * Get reference locations
	 * @param uri - Document URI
	 * @param position - Position
	 */
	getReferences(uri: string, position: vscode.Position): Promise<vscode.Location[]>;
}

/**
 * AI and chat integration APIs (Phase 3)
 */
export interface PositronAiApi {
	/**
	 * Get current plot URI
	 */
	getCurrentPlotUri(): Promise<string | undefined>;

	/**
	 * Get Positron chat context
	 * @param request - Chat request
	 */
	getPositronChatContext(request: any): Promise<ChatContext>;

	/**
	 * Check if completions are enabled for file
	 * @param file - File URI
	 */
	areCompletionsEnabled(file: vscode.Uri): Promise<boolean>;

	/**
	 * Get chat export data
	 */
	getChatExport(): Promise<object | undefined>;
}

/**
 * Connection management APIs (Phase 3)
 */
export interface PositronConnectionsApi {
	/**
	 * List available connections
	 */
	listConnections(): Promise<Connection[]>;

	/**
	 * Create a new connection
	 * @param config - Connection configuration
	 */
	createConnection(config: ConnectionConfig): Promise<void>;

	/**
	 * Test a connection
	 * @param config - Connection configuration
	 */
	testConnection(config: ConnectionConfig): Promise<boolean>;
}

/**
 * Environment APIs (Phase 3)
 */
export interface PositronEnvironmentApi {
	/**
	 * Get environment variable contributions
	 */
	getEnvironmentContributions(): Promise<Record<string, EnvironmentVariableAction[]>>;

	/**
	 * Get process information
	 */
	getProcessInfo(): Promise<ProcessInfo>;
}

// Type definitions

/**
 * Runtime session information
 */
export interface RuntimeSession {
	metadata: {
		sessionId: string;
		sessionName: string;
		sessionMode: 'Console' | 'Notebook' | 'Background';
		createTime: number;
		startTime?: number;
		endTime?: number;
		state: string;
		exitCode?: number;
	};
	runtimeMetadata: {
		languageId: string;
		languageName: string;
		languageVersion: string;
		runtimeId: string;
		runtimeName: string;
		runtimeVersion: string;
		runtimePath: string;
	};
	dynState: {
		sessionName: string;
		workingDirectory: string;
		busy: boolean;
		hasShutdown: boolean;
	};
}

/**
 * Code execution options
 */
export interface ExecuteCodeOptions {
	/** Whether to focus the runtime console after execution */
	focus?: boolean;

	/** Whether to allow incomplete code to be executed */
	allowIncomplete?: boolean;

	/** Code execution mode */
	mode?: 'interactive' | 'non-interactive' | 'transient' | 'silent';

	/** Error handling behavior */
	errorBehavior?: 'stop' | 'continue';

	/** Optional execution observer for streaming results */
	observer?: ExecutionObserver;
}

/**
 * Code execution result
 */
export interface ExecutionResult {
	/** Execution success status */
	success: boolean;

	/** Result data by MIME type */
	data?: Record<string, any>;

	/** Error information if execution failed */
	error?: {
		name: string;
		message: string;
		traceback?: string[];
	};

	/** Execution metadata */
	metadata?: {
		executionCount?: number;
		duration?: number;
		timestamp?: string;
	};
}

/**
 * Execution observer for streaming results
 */
export interface ExecutionObserver {
	/** Optional cancellation token */
	token?: vscode.CancellationToken;

	/** Called when execution starts */
	onStarted?(): void;

	/** Called when output is produced */
	onOutput?(message: string): void;

	/** Called when error output is produced */
	onError?(message: string): void;

	/** Called when execution completes successfully */
	onCompleted?(result: Record<string, any>): void;

	/** Called when execution fails */
	onFailed?(error: Error): void;

	/** Called when execution finishes (success or failure) */
	onFinished?(): void;
}

/**
 * Variable information
 */
export interface Variable {
	name: string;
	type: string;
	value: string;
	size?: number;
	kind?: string;
	hasChildren?: boolean;
	path?: string[];
}

/**
 * Query table result
 */
export interface QueryTableResult {
	columns: string[];
	rows: any[][];
	rowCount: number;
}

/**
 * Code execution event
 */
export interface CodeExecutionEvent {
	sessionId: string;
	code: string;
	languageId: string;
	timestamp: number;
}

/**
 * Language runtime metadata
 */
export interface LanguageRuntimeMetadata {
	runtimeId: string;
	runtimeName: string;
	languageId: string;
	languageName: string;
	languageVersion: string;
	runtimePath: string;
}

/**
 * Console information
 */
export interface Console {
	id: string;
	languageId: string;
	width: number;
	height: number;
}

/**
 * Plot render settings
 */
export interface PlotRenderSettings {
	width: number;
	height: number;
	pixelRatio: number;
	format: 'png' | 'svg' | 'jpeg';
}

/**
 * Preview options
 */
export interface PreviewOptions {
	viewColumn?: vscode.ViewColumn;
	preserveFocus?: boolean;
	enableScripts?: boolean;
	enableForms?: boolean;
}

/**
 * Preview panel
 */
export interface PreviewPanel {
	readonly viewType: string;
	readonly title: string;
	readonly webview: vscode.Webview;
	readonly visible: boolean;
	reveal(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
	dispose(): void;
}

/**
 * Document information
 */
export interface DocumentInfo {
	uri: string;
	languageId: string;
	fileName: string;
	isUntitled: boolean;
	isDirty: boolean;
	lineCount: number;
	content?: string;
}

/**
 * Selection information
 */
export interface SelectionInfo {
	text: string;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
}

/**
 * Editor context
 */
export interface EditorContext {
	document: vscode.TextDocument;
	selection: vscode.Selection;
	visibleRanges: vscode.Range[];
}

/**
 * Workspace folder
 */
export interface WorkspaceFolder {
	uri: string;
	name: string;
	index: number;
}

/**
 * Configuration interface
 */
export interface Configuration {
	get<T>(key: string, defaultValue?: T): T | undefined;
	has(key: string): boolean;
	inspect<T>(key: string): {
		key: string;
		defaultValue?: T;
		globalValue?: T;
		workspaceValue?: T;
		workspaceFolderValue?: T;
	} | undefined;
}

/**
 * Statement range
 */
export interface StatementRange {
	range: vscode.Range;
	code: string;
}

/**
 * Chat context
 */
export interface ChatContext {
	messages: any[];
	context: any;
}

/**
 * Connection information
 */
export interface Connection {
	id: string;
	name: string;
	type: string;
	status: 'connected' | 'disconnected' | 'error';
	config: ConnectionConfig;
}

/**
 * Connection configuration
 */
export interface ConnectionConfig {
	name: string;
	type: string;
	host?: string;
	port?: number;
	database?: string;
	username?: string;
	password?: string;
	options?: Record<string, any>;
}

/**
 * Environment variable action
 */
export interface EnvironmentVariableAction {
	variable: string;
	action: 'set' | 'append' | 'prepend' | 'remove';
	value?: string;
}

/**
 * Process information
 */
export interface ProcessInfo {
	pid: number;
	platform: string;
	arch: string;
	version: string;
	memoryUsage: {
		rss: number;
		heapTotal: number;
		heapUsed: number;
		external: number;
	};
}