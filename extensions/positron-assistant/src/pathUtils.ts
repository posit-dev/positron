/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Determines if a path string is relative (not absolute).
 * A path is considered absolute if it:
 * - Starts with '/' (POSIX)
 * - Starts with a drive letter like 'C:\' (Windows)
 * - Is a URI scheme like 'file://' or 'vscode://'
 */
export function isRelativePath(pathString: string): boolean {
	// Handle empty or whitespace-only paths
	if (!pathString || pathString.trim() === '') {
		return false;
	}

	// Check for URI schemes (file://, vscode://, etc.)
	if (/^[a-z][a-z0-9+.-]*:/i.test(pathString)) {
		return false;
	}

	// Check for absolute POSIX paths
	if (pathString.startsWith('/')) {
		return false;
	}

	// Check for Windows absolute paths (C:\, D:\, etc.)
	if (/^[a-zA-Z]:[\\\/]/.test(pathString)) {
		return false;
	}

	// If none of the above, it's relative
	return true;
}

/**
 * Resolves a relative path against the workspace root folder.
 * Returns the absolute path if already absolute, or undefined if no workspace is open.
 */
export function resolvePathAgainstWorkspace(pathString: string): string | undefined {
	// If already absolute or a URI, return as-is
	if (!isRelativePath(pathString)) {
		return pathString;
	}

	// Get workspace folders
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		// No workspace open - return undefined to let tool handle gracefully
		return undefined;
	}

	// Use the first workspace folder for resolution
	// In multi-root workspaces, this is a reasonable default
	const workspaceRoot = workspaceFolders[0].uri.fsPath;

	// Normalize path separators and resolve relative components (., ..)
	const resolvedPath = path.resolve(workspaceRoot, pathString);

	return resolvedPath;
}

// Prefixes used in the copilot_applyPatch input string to denote file operations.
// These must match the constants in positron-copilot-chat's parseApplyPatch.ts.
const APPLY_PATCH_PATH_PREFIXES = [
	'*** Add File: ',
	'*** Delete File: ',
	'*** Update File: ',
	'*** Move to: ',
];

/**
 * Resolves relative paths embedded in a copilot_applyPatch input string.
 * Paths appear on lines like "*** Add File: test.R" and must be absolute for
 * the patch tool to locate them via IPromptPathRepresentationService.
 */
export function resolveApplyPatchPaths(patchInput: string): string {
	return patchInput.split('\n').map(line => {
		for (const prefix of APPLY_PATCH_PATH_PREFIXES) {
			if (line.startsWith(prefix)) {
				const filePath = line.slice(prefix.length);
				const resolved = resolvePathAgainstWorkspace(filePath);
				return resolved ? prefix + resolved : line;
			}
		}
		return line;
	}).join('\n');
}

/**
 * Resolves paths in Copilot tool input objects.
 * Only processes copilot_* tools to avoid interfering with non-Copilot tools.
 *
 * Handles:
 * - copilot_createFile: { filePath: string, content?: string }
 * - copilot_readFile: { filePath: string, offset?: number, limit?: number }
 * - copilot_applyPatch: { input: string, explanation: string }
 *   (paths are embedded in the input string and resolved line-by-line)
 */
export function resolveToolInputPaths(toolName: string, input: any): any {
	// Only process Copilot tools
	if (!toolName.startsWith('copilot_')) {
		return input;
	}

	// Handle copilot_createFile and copilot_readFile
	if ((toolName === 'copilot_createFile' || toolName === 'copilot_readFile') && input?.filePath) {
		const resolvedPath = resolvePathAgainstWorkspace(input.filePath);
		if (resolvedPath) {
			return { ...input, filePath: resolvedPath };
		}
		// If resolution failed (no workspace), return original input
		// The tool will fail with a more specific error message
		return input;
	}

	// copilot_applyPatch embeds paths inside the patch string itself.
	// Resolve any relative paths found on file operation lines.
	if (toolName === 'copilot_applyPatch' && typeof input?.input === 'string') {
		return { ...input, input: resolveApplyPatchPaths(input.input) };
	}

	// For any other copilot_* tools, return input unchanged
	return input;
}
