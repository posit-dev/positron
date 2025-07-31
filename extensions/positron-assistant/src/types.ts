/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
