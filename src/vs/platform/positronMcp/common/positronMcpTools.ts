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

import { DEFAULT_MAX_CONSOLE_ENTRIES, MAX_CONSOLE_ENTRIES_LIMIT, MCP_USER_CONTEXT_SECTIONS } from './positronMcpContext.js';

/** A block of MCP tool-result content (the wire shape sent to the client). */
export type McpContent =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string };

/** The result of a `tools/call`, matching the MCP wire shape. */
export interface IMcpCallToolResult {
	content: McpContent[];
	isError?: boolean;
	/**
	 * Internal handler-to-server metadata; never part of the wire shape. The
	 * session's audit choke point reads it, then strips it before the response
	 * leaves the server.
	 */
	auditHint?: {
		/**
		 * The result carries console history (code/output the user typed). Such
		 * calls are recorded in the JSONL audit file at full detail regardless
		 * of the `positron.mcp.auditLog.detail` setting's summary mode.
		 */
		returnedConsoleContent?: boolean;
		/**
		 * The result already reports everything an alert would have flagged,
		 * up to and including seq `to`: advance the client's alert cursor there
		 * and skip the `[context: ...]` line. The ledger owns the whole rule --
		 * it computes this hint (query's `advanceCursor`) and validates it on
		 * arrival (advanceCursorForReport); handlers and the session only carry
		 * it. Events recorded after `to` stay pending, and the advance is
		 * ignored entirely when `reportedSince` is ahead of the cursor (the
		 * report skipped events the client was still owed).
		 */
		advanceContextCursor?: { to: number; reportedSince?: number };
	};
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
 * whole string well under the ~2KB clients retain.
 *
 * Channel budgeting: this field holds only the framing that must land before
 * the model picks a tool -- prefer the live session over its own shell, work
 * incrementally, never touch .ipynb files directly. Per-tool mechanics live in
 * the tool descriptions in {@link POSITRON_MCP_TOOLS}, which clients re-send
 * with every request and never compact.
 */
export const SERVER_INSTRUCTIONS = `These tools connect to a live Positron IDE session (Python and/or R) the user is working in. Do all data work -- finding, loading, cleaning, analyzing, plotting, and modeling data -- inside Positron with these tools, not your own shell or file editor. Running Python or R yourself hides the work from the user and loses the session's shared state.

Running code: execute-code runs in the user's console session; variables and imports persist across calls and are shared with the user. Work incrementally -- load libraries, then load data, inspect it, then transform it -- running and checking each step before the next, instead of writing one big script and running it in one shot. The console is a separate runtime from a notebook's kernel, so never run notebook cells with execute-code.

Notebooks: work on the user's notebook with the notebook-* tools (read, edit, run cells, create) -- never read or hand-edit the .ipynb file with your own tools, which corrupts notebook state and misses the live outputs.

Data: before writing code against data, look first -- get-session for the active language, get-variables and inspect-variable for what is defined, profile-data for summary statistics, get-packages for installed packages -- instead of guessing column names or running mutating inspection code.

Plots: after plotting with execute-code, call get-plot to see the image. After writing a file to disk, call open-document to show it to the user.

Context updates: tool results may end with a [context: ...] line summarizing user activity in Positron since your last call. If it reports new errors, call get-user-context (since: <the seq from that line>) before continuing. For routine executions, only investigate if your current task depends on session state.`;

/**
 * The get-session result text when no runtime session is active. Shared
 * because two layers need the exact string: the renderer's handler serves it,
 * and the main-process session compares against it at initialize time to skip
 * appending a session snapshot to the instructions.
 */
export const NO_ACTIVE_SESSION_TEXT = 'No active runtime session. Use session-start to begin one.';

const EMPTY_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };

/**
 * The window-routed MCP tools Positron advertises. Ported verbatim from the
 * positron-mcp extension's `buildTools()` (metadata only). The renderer binds a
 * handler to each `name`; {@link PositronMcpToolName} ties the two at compile
 * time, so a descriptor without a handler (or vice versa) is a type error.
 * Tools the main process serves itself (get-guidance, in positronMcpGuides.ts)
 * live outside this list and are appended by the session at tools/list time.
 */
export const POSITRON_MCP_TOOLS = [
	{
		name: 'get-session',
		description: 'Get the active runtime session: its language, name, and ID. Call this first to learn which language (Python or R) is running before running code or inspecting variables.',
		inputSchema: EMPTY_SCHEMA,
		annotations: { readOnlyHint: true },
	},
	{
		name: 'get-user-context',
		description: 'Get what the user has been doing in Positron: the active session, the focused editor (path, cursor, selection), recent console executions (who ran what, with output and status), recent uncaught errors with tracebacks, and open notebooks. Call this when a tool result\'s [context: ...] line reports activity you need to see, passing that line\'s seq as `since` to get only what changed; without `since` it returns a full snapshot. Outputs are truncated per entry - use inspect-variable to read large values. If the response notes omitted entries, call again with a higher maxConsoleEntries.',
		inputSchema: {
			type: 'object',
			properties: {
				include: {
					type: 'array',
					minItems: 1,
					items: { type: 'string', enum: MCP_USER_CONTEXT_SECTIONS },
					description: 'Sections to return. Omit for all sections.',
				},
				since: {
					type: 'integer',
					minimum: 0,
					description: 'An event seq from a [context: ...] line or a previous response. console/errors return only events after it; session/editor/notebooks are included only if they changed after it.',
				},
				maxConsoleEntries: {
					type: 'integer',
					default: DEFAULT_MAX_CONSOLE_ENTRIES,
					minimum: 1,
					maximum: MAX_CONSOLE_ENTRIES_LIMIT,
					description: 'Cap on console and errors entries returned (most recent kept).',
				},
			},
			additionalProperties: false,
		},
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
		description: 'Execute code in the user\'s active console session. Runs in the live, shared console runtime, so variables and imports persist across calls. This is separate from a notebook\'s kernel -- do not use it to run notebook cells; use notebook-run-cells or notebook-edit(run) for those. Call get-session first to confirm the active language; use session-start if no session is active. To run a saved script, send its code here (and open it with open-document so it stays visible to the user), not source() / Rscript / python file.py, which hide what ran.',
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
] as const satisfies readonly IPositronMcpToolDescriptor[];

/** The name of an advertised MCP tool; the renderer's handler table is keyed by this union. */
export type PositronMcpToolName = typeof POSITRON_MCP_TOOLS[number]['name'];

/**
 * Which in-flight tool plausibly causes each context change-event kind. The
 * renderer's context observer attributes a workbench event to the active tool
 * call only when its tool is in the matching set; otherwise it counts as the
 * user's, even mid-call -- a user switching editors while an agent's
 * execute-code runs is user activity, and over-attributing it to the agent
 * would hide it from every alert.
 *
 * This lives next to the tool table because it is part of a tool's
 * definition: when adding a tool that opens editors or notebooks or starts
 * sessions, list it here, or its own effects are alerted back to its client
 * as user activity. Constructing the sets against the tool-name union makes a
 * renamed or removed tool fail to compile; it cannot catch a newly added tool
 * that is missing here -- that is the by-hand step above. The declared type
 * stays string-keyed for the lookup of arbitrary call names.
 */
export const CHANGE_CAUSING_TOOLS: Record<'editor' | 'notebook' | 'session', ReadonlySet<string>> = {
	editor: new Set<PositronMcpToolName>(['open-document', 'notebook-create']),
	// open-document included: an .ipynb path opens the notebook editor, which
	// registers a notebook instance mid-call.
	notebook: new Set<PositronMcpToolName>(['open-document', 'notebook-create']),
	// The notebook tools are here too: opening an .ipynb synchronously flips
	// the foreground session to that notebook's (running or last-used) kernel
	// mid-call, which would otherwise self-echo as user activity. A flip that
	// lands after the call returns (a fresh notebook's kernel reaching Ready)
	// is out of attribution reach either way.
	//
	// execute-code and notebook-run-cells are deliberately absent even though
	// both can foreground or auto-start a session mid-call: they run long
	// (seconds to unbounded) and attribution spans the whole call, so listing
	// them would hide a user's genuine session switch made during that window.
	// The accepted cost is one true-but-self-caused "active session changed"
	// alert to the caller.
	session: new Set<PositronMcpToolName>(['session-start', 'session-restart', 'open-document', 'notebook-create']),
};
