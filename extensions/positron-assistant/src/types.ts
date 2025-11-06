/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RuntimeVariable } from 'positron';
import * as vscode from 'vscode';

export enum PositronAssistantToolName {
	DocumentEdit = 'documentEdit',
	EditFile = 'positron_editFile_internal',
	ExecuteCode = 'executeCode',
	GetTableSummary = 'getTableSummary',
	GetPlot = 'getPlot',
	InstallPythonPackage = 'installPythonPackage',
	InspectVariables = 'inspectVariables',
	SelectionEdit = 'selectionEdit',
	ProjectTree = 'getProjectTree',
	GetChangedFiles = 'getChangedFiles',
	DocumentCreate = 'documentCreate',
	TextSearch = 'positron_findTextInProject_internal',
	FileContents = 'positron_getFileContents_internal',
	RunNotebookCells = 'runNotebookCells',
	AddNotebookCell = 'addNotebookCell',
	UpdateNotebookCell = 'updateNotebookCell',
	GetCellOutputs = 'getCellOutputs',
	GetNotebookCells = 'getNotebookCells',
}

/**
 * Custom LanguageModelDataPart mime types.
 */
export enum LanguageModelDataPartMimeType {
	/**
	 * Defines a cache breakpoint (e.g. for Anthropic's manual prompt caching).
	 *
	 * By matching the Copilot extension, other extensions that use models from either Copilot
	 * or Positron Assistant can set cache breakpoints with the same mime type.
	 * See: https://github.com/microsoft/vscode-copilot-chat/blob/6aeac371813be9037e74395186ec5b5b94089245/src/platform/endpoint/common/endpointTypes.ts#L7
	 */
	CacheControl = 'cache_control',
}

/**
 * The type of cache breakpoint.
 */
export enum LanguageModelCacheBreakpointType {
	/**
	 * Defines a short-lived cache.
	 */
	Ephemeral = 'ephemeral',
}

/**
 * Represents a cache breakpoint in a LanguageModelDataPart.
 */
export interface LanguageModelCacheBreakpoint {
	/**
	 * The type of cache breakpoint.
	 */
	type: LanguageModelCacheBreakpointType;
}

/**
 * Represents the context information that is sent as part of the request to the model.
 */
export type ContextInfo = {
	/** The constructed language model message */
	message: vscode.LanguageModelChatMessage2;
	/** The prompts that are part of the message */
	prompts: string[];
	/** The mimeTypes for attached data included in the message */
	attachedDataTypes?: string[];
};


/**
 * A reference to a runtime session, usually the active session in the IDE.
 *
 * This is derived from `IChatRequestRuntimeSessionEntry`, but the `variables`
 * entry has type `RuntimeVariable[]` instead of `any[]`. I believe the actual
 * type of `variables` is `Variable[]` from positronVariablesComm.ts, but that
 * type is not exported in positron.d.ts, so we'll use `RuntimeVariable`
 * instead.
 *
 * Note that this does not exactly reflect the structure of the reference object
 * that's passed in to the chat request. It would be better if those types were
 * accurately reflected in vscode.d.ts or positron.d.ts.
 *
 * TODO: Confirm type definitions, consider contributing to positron.d.ts
 */
export interface RuntimeSessionReference {
	activeSession: {
		identifier: string;
		language: string;
		version: string;
		mode: string;
		notebookUri?: any;
		executions: {
			input: string;
			output: string;
			error?: any;
		}[];
	};
	variables: Variable[];
}

/**
 * A prompt instructions file reference.
 */
export interface PromptInstructionsReference {
	id: string;
	modelDescription: string;
	name: string;
	value: vscode.Uri;
}

/**
 * A single variable in the runtime.
 *
 * This is from positronVariablesComm.ts, but it is not exported in positron.d.ts.
 */
export interface Variable {
	/**
	 * A key that uniquely identifies the variable within the runtime and can
	 * be used to access the variable in `inspect` requests
	 */
	access_key: string;

	/**
	 * The name of the variable, formatted for display
	 */
	display_name: string;

	/**
	 * A string representation of the variable's value, formatted for display
	 * and possibly truncated
	 */
	display_value: string;

	/**
	 * The variable's type, formatted for display
	 */
	display_type: string;

	/**
	 * Extended information about the variable's type
	 */
	type_info: string;

	/**
	 * The size of the variable's value in bytes
	 */
	size: number;

	/**
	 * The kind of value the variable represents, such as 'string' or
	 * 'number'
	 */
	kind: VariableKind;

	/**
	 * The number of elements in the variable, if it is a collection
	 */
	length: number;

	/**
	 * Whether the variable has child variables
	 */
	has_children: boolean;

	/**
	 * True if there is a viewer available for this variable (i.e. the
	 * runtime can handle a 'view' request for this variable)
	 */
	has_viewer: boolean;

	/**
	 * True if the 'value' field is a truncated representation of the
	 * variable's value
	 */
	is_truncated: boolean;

	/**
	 * The time the variable was created or updated, in milliseconds since
	 * the epoch, or 0 if unknown.
	 */
	updated_time: number;
}

/**
 * Possible values for Kind in Variable
 *
 * This is from positronVariablesComm.ts, but it is not exported in positron.d.ts.
 */
export enum VariableKind {
	Boolean = 'boolean',
	Bytes = 'bytes',
	Class = 'class',
	Collection = 'collection',
	Empty = 'empty',
	Function = 'function',
	Map = 'map',
	Number = 'number',
	Other = 'other',
	String = 'string',
	Table = 'table',
	Lazy = 'lazy',
	Connection = 'connection'
}
