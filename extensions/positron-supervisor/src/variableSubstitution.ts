/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

/**
 * Substitutes variables in a string with their resolved values.
 * Supports common variables like ${workspaceFolder}, ${fileDirname}, etc.
 *
 * @param value The string containing variables to substitute
 * @param notebookUri The URI of the notebook file (optional)
 * @returns The string with variables substituted
 */
export function substituteVariables(value: string, notebookUri?: vscode.Uri): string {
	if (!value) {
		return value;
	}

	const variableRegex = /\$\{([^}]+)\}/g;

	return value.replace(variableRegex, (match, variable) => {
		// Handle ${workspaceFolder} - the first workspace folder
		if (variable === 'workspaceFolder') {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			return workspaceFolder ? workspaceFolder.uri.fsPath : match;
		}

		// Handle ${workspaceFolder:name} - specific workspace folder by name
		if (variable.startsWith('workspaceFolder:')) {
			const folderName = variable.substring('workspaceFolder:'.length);
			const workspaceFolder = vscode.workspace.workspaceFolders?.find(
				folder => folder.name === folderName
			);
			return workspaceFolder ? workspaceFolder.uri.fsPath : match;
		}

		// Handle ${fileDirname} - directory of the current notebook
		if (variable === 'fileDirname' && notebookUri) {
			return path.dirname(notebookUri.fsPath);
		}

		// Handle ${fileBasename} - name of the current notebook file
		if (variable === 'fileBasename' && notebookUri) {
			return path.basename(notebookUri.fsPath);
		}

		// Handle ${fileBasenameNoExtension} - name without extension
		if (variable === 'fileBasenameNoExtension' && notebookUri) {
			const basename = path.basename(notebookUri.fsPath);
			const extname = path.extname(basename);
			return basename.slice(0, -extname.length);
		}

		// Handle ${fileExtname} - extension of the current notebook
		if (variable === 'fileExtname' && notebookUri) {
			return path.extname(notebookUri.fsPath);
		}

		// Handle ${file} - full path of the current notebook
		if (variable === 'file' && notebookUri) {
			return notebookUri.fsPath;
		}

		// Handle ${relativeFile} - relative path from workspace folder
		if (variable === 'relativeFile' && notebookUri) {
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(notebookUri);
			if (workspaceFolder) {
				return path.relative(workspaceFolder.uri.fsPath, notebookUri.fsPath);
			}
			return notebookUri.fsPath;
		}

		// Handle ${relativeFileDirname} - relative directory from workspace folder
		if (variable === 'relativeFileDirname' && notebookUri) {
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(notebookUri);
			if (workspaceFolder) {
				const dirname = path.dirname(notebookUri.fsPath);
				return path.relative(workspaceFolder.uri.fsPath, dirname);
			}
			return path.dirname(notebookUri.fsPath);
		}

		// Handle ${cwd} - current working directory
		if (variable === 'cwd') {
			return process.cwd();
		}

		// Handle ${userHome} - user home directory
		if (variable === 'userHome') {
			return os.homedir();
		}

		// Handle ${pathSeparator} - OS path separator
		if (variable === 'pathSeparator') {
			return path.sep;
		}

		// Handle ${/} - alias for path separator
		if (variable === '/') {
			return path.sep;
		}

		// Handle ${env:VARIABLE_NAME} - environment variables
		if (variable.startsWith('env:')) {
			const envVar = variable.substring('env:'.length);
			return process.env[envVar] || '';
		}

		// Return the original match if we couldn't resolve the variable
		return match;
	});
}
