/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Static MCP tool metadata, shared by the node server (which serves `tools/list`
 * and `initialize`) and the renderer tool registry (which maps each name to a
 * handler). The handlers live renderer-side; this file is metadata only, so it
 * has no DOM or Node dependency and is safe in `common`.
 *
 * Keep this list and {@link SERVER_INSTRUCTIONS} in sync with each other.
 */

/** A block of MCP tool-result content (the wire shape sent to the client). */
export type McpContent =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string };

/** The result of a `tools/call`, matching the MCP wire shape. */
export interface IMcpCallToolResult {
	content: McpContent[];
	isError?: boolean;
}

/**
 * MCP tool annotations: optional hints clients use to gate and parallelize tool
 * calls (e.g. auto-approving read-only tools, confirming destructive ones).
 */
export interface IMcpToolAnnotations {
	readonly readOnlyHint?: boolean;
	readonly destructiveHint?: boolean;
	readonly idempotentHint?: boolean;
	readonly openWorldHint?: boolean;
}

/** One MCP tool's advertised schema (no handler -- that lives renderer-side). */
export interface IPositronMcpToolDescriptor {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: object;
	readonly annotations?: IMcpToolAnnotations;
}

/** MCP protocol version this server speaks. */
export const POSITRON_MCP_PROTOCOL_VERSION = '2025-06-18';

/** Server identity returned in the `initialize` handshake. */
export const POSITRON_MCP_SERVER_INFO = { name: 'positron-mcp-server', version: '1.0.0' } as const;

/**
 * Guidance returned in the `initialize` response `instructions` field. MCP
 * clients (Claude Code, Codex) surface this to the model as server-wide guidance
 * and prioritize the opening, so keep the most important framing first and the
 * whole string well under the ~2KB clients retain. Keep it in sync with
 * {@link POSITRON_MCP_TOOLS}.
 */
export const SERVER_INSTRUCTIONS = `These tools connect to a live Positron IDE session (Python and/or R) the user is working in. Do all data work -- finding, loading, cleaning, analyzing, plotting, and modeling data -- inside Positron with these tools, not your own shell or file editor. Running Python or R yourself hides the work from the user and loses the session's shared state.

Running code: execute-code runs in the user's console session; variables and imports persist across calls and are shared with the user. Work incrementally -- load libraries, then load data, inspect it, then transform it -- running and checking each step before the next, instead of writing one big script and running it in one shot; this shows your work and catches errors early. To run a saved script, send its code to the session (open it with open-document so it stays visible), not source() or Rscript, which hide what ran. The console session is a different runtime from a notebook's kernel, so do NOT run notebook cells with execute-code -- use the notebook tools below. Use get-session for the active language and get-variables to see what is defined; session-start if none is active.

Plots: after plotting with execute-code, call get-plot to see the image from the Plots pane. A plot from a notebook cell renders inline as a cell output (not in the Plots pane) and is returned directly by notebook-run-cells / notebook-edit(run) -- get-plot will not show it.

Notebooks: use notebook-read, notebook-edit, notebook-run-cells, and notebook-create; run cells with notebook-run-cells or notebook-edit(run:true), never execute-code. A notebook can be open while the console or another view has focus, and get-active-document does not report notebooks; these tools act on the open notebook regardless of focus, so call notebook-read directly rather than reopening it or assuming none is open. Never read or hand-edit the .ipynb file or parse its JSON -- that corrupts notebook state. Cells are 0-indexed and indices shift after an insert or delete, so re-read before further edits.

Files: after writing a script or file to disk, call open-document to show it to the user.

Data: list variables with get-variables, then inspect-variable for a specific dataframe's columns and types, before writing code against it -- do not guess column names. Use profile-data for a dataframe's per-column summary statistics (min, max, mean, unique counts) the way the Data Explorer computes them, instead of running df.describe() / summary(). Use get-packages to see which packages are installed instead of running pip list / installed.packages(). Use get-diagnostics for a file's errors/warnings, and session-interrupt / session-restart if the session hangs.`;

const EMPTY_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };

/**
 * The full set of MCP tools Positron advertises. Ported verbatim from the
 * positron-mcp extension's `buildTools()` (metadata only). The renderer binds a
 * handler to each `name`.
 */
export const POSITRON_MCP_TOOLS: readonly IPositronMcpToolDescriptor[] = [
	{
		name: 'get-session',
		description: 'Get the active runtime session: its language, name, and ID. Call this first to learn which language (Python or R) is running before running code or inspecting variables.',
		inputSchema: EMPTY_SCHEMA,
		annotations: { readOnlyHint: true },
	},
	{
		name: 'get-variables',
		description: 'List the variables defined in the active runtime session with their types and values. Check this before writing code against a dataframe so you don\'t guess column names.',
		inputSchema: EMPTY_SCHEMA,
		annotations: { readOnlyHint: true },
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
	},
	{
		name: 'profile-data',
		description: 'Profile a dataframe variable in the active session: per-column summary statistics (min, max, mean, median, and standard deviation for numbers; unique and empty counts for strings; true/false counts for booleans) -- the same computations Positron\'s Data Explorer runs, with no mutating df.describe() / summary() call. Pass a variable name as shown by get-variables; optionally limit to specific columns.',
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'The display name of the dataframe variable to profile, as shown by get-variables (e.g. "df").' },
				columns: { type: 'array', items: { type: 'string' }, description: 'Optional subset of column names to profile. If omitted, all columns are profiled.' },
			},
			required: ['name'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true },
	},
	{
		name: 'get-packages',
		description: 'List the packages installed in the active runtime session -- the same data shown in the Packages pane -- with each package\'s version and whether it is attached and/or outdated. Use this instead of running pip list / installed.packages() in the session.',
		inputSchema: EMPTY_SCHEMA,
		annotations: { readOnlyHint: true },
	},
	{
		name: 'execute-code',
		description: 'Execute code in the user\'s active console session. Runs in the live, shared console runtime, so variables and imports persist across calls. This is separate from a notebook\'s kernel -- do not use it to run notebook cells; use notebook-run-cells or notebook-edit(run) for those. Call get-session first to confirm the active language.',
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
	},
	{
		name: 'get-active-document',
		description: 'Get information about the editor document the user is currently working in: its path, language, and optionally its content or selected text. If the open editor is a notebook, this reports the notebook\'s path and points you to notebook-read for its cell contents.',
		inputSchema: {
			type: 'object',
			properties: {
				includeContent: { type: 'boolean', default: false, description: 'Include the full document text.' },
				includeSelection: { type: 'boolean', default: true, description: 'Include the currently selected text and its range.' },
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true },
	},
	{
		name: 'open-document',
		description: 'Open a file in the Positron editor so the user can see it, e.g. after writing or modifying a script file. The file may already be open; for a notebook, use notebook-read to see its cells instead of reopening it (this tool does not read cell contents).',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Absolute path, or a path relative to the first workspace folder.' },
			},
			required: ['path'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false },
	},
	{
		name: 'get-workspace-info',
		description: 'List the workspace folders (project roots) open in Positron. Use to resolve relative paths and understand the project layout.',
		inputSchema: EMPTY_SCHEMA,
		annotations: { readOnlyHint: true },
	},
	{
		name: 'notebook-read',
		description: 'Read cells of the Positron notebook the user is working in (the open notebook -- it does not need to be the focused tab). Returns each cell\'s index, type, content, and execution status. Optionally read specific cells by index and include their outputs (text, plus any plots as images). Use this instead of opening the .ipynb file directly.',
		inputSchema: {
			type: 'object',
			properties: {
				cellIndices: { type: 'array', items: { type: 'integer' }, description: '0-based cell indices to read. If omitted, reads all cells.' },
				includeOutputs: { type: 'boolean', default: false, description: 'Include the outputs of executed code cells: text, plus any plots as images.' },
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true },
	},
	{
		name: 'notebook-edit',
		description: 'Edit the Positron notebook the user is working in (the open notebook -- it does not need to be the focused tab): insert a new cell (optionally running it), update an existing cell\'s content, or delete a cell. Do not hand-edit the .ipynb file; cell indices shift after an insert or delete, so re-read before further edits.',
		inputSchema: {
			type: 'object',
			properties: {
				editMode: { type: 'string', enum: ['insert', 'update', 'delete'], description: 'The kind of edit to make.' },
				cellIndex: { type: 'integer', description: '0-based index. Required for update and delete. For insert, the position to insert at (omit to append at the end).' },
				content: { type: 'string', description: 'Cell content. Required for insert and update.' },
				cellType: { type: 'string', enum: ['code', 'markdown'], description: 'Cell type. Required for insert.' },
				run: { type: 'boolean', default: false, description: 'If inserting a code cell, execute it immediately and return its output (text, plus any plot as an image).' },
			},
			required: ['editMode'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false },
	},
	{
		name: 'notebook-run-cells',
		description: 'Execute one or more cells in the Positron notebook the user is working in (the open notebook -- it does not need to be the focused tab) and return their outputs: text, plus any plots as images. This is how you run notebook code -- do not use execute-code, which targets the separate console session.',
		inputSchema: {
			type: 'object',
			properties: {
				cellIndices: { type: 'array', items: { type: 'integer' }, description: '0-based cell indices to execute.' },
			},
			required: ['cellIndices'],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false },
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
	},
	{
		name: 'get-plot',
		description: 'Get the plot currently shown in the Positron Plots pane as an image. Run plotting code with execute-code first, then call this to see the result. This is for console plots only: a plot produced by a notebook cell is returned inline by notebook-run-cells / notebook-edit(run), not here.',
		inputSchema: EMPTY_SCHEMA,
		annotations: { readOnlyHint: true },
	},
	{
		name: 'enlarge-plots-pane',
		description: 'Focus and enlarge the Positron Plots pane so plots render at a usable size. If a plot looks squished in a small pane, call this and then re-run the plotting code so it re-renders larger.',
		inputSchema: EMPTY_SCHEMA,
		annotations: { readOnlyHint: false },
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
	},
	{
		name: 'session-interrupt',
		description: 'Interrupt the active runtime session to stop a long-running or stuck computation.',
		inputSchema: EMPTY_SCHEMA,
		annotations: { readOnlyHint: false },
	},
	{
		name: 'session-restart',
		description: 'Restart the active runtime session. This clears all variables and loaded data; the user is asked to confirm first.',
		inputSchema: EMPTY_SCHEMA,
		annotations: { readOnlyHint: false, destructiveHint: true },
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
	},
];
