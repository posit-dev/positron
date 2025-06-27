/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export enum PositronAssistantToolName {
	DocumentEdit = 'documentEdit',
	EditFile = 'positron_editFile_internal',
	ExecuteCode = 'executeCode',
	GetPlot = 'getPlot',
	InstallPythonPackage = 'installPythonPackage',
	InspectVariables = 'inspectVariables',
	SelectionEdit = 'selectionEdit',
	ProjectTree = 'getProjectTree',
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
	 */
	CacheBreakpoint = 'application/cache-control+json',
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
