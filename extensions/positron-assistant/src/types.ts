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
	GetChangedFiles = 'getChangedFiles',
	DocumentCreate = 'documentCreate',
	TextSearch = 'positron_findTextInProject_internal',
	FileContents = 'positron_getFileContents_internal',
}
