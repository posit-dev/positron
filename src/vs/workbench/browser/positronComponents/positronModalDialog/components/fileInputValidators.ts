/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { isValidBasename } from '../../../../../base/common/extpath.js';
import { OS, OperatingSystem } from '../../../../../base/common/platform.js';
import { basename } from '../../../../../base/common/resources.js';
import { truncateMiddle } from '../../../../../base/common/strings.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IFileService } from '../../../../../platform/files/common/files.js';

interface PathValidatorOptions {
	/**
	 * Whether to forbid absolute paths. Defaults to false.
	 */
	noAbsolutePaths?: boolean;
	/**
	 * Parent of the path if it exists.
	 */
	parentPath?: string;
}

// This is adapted from the `validateFileName` function in `vs/workbench/contrib/files/browser/fileActions.ts`.
// Returns an error message if the path is invalid, otherwise returns undefined.
export function checkIfPathValid(path: string | number, opts: PathValidatorOptions = {}): string | undefined {
	path = path.toString();

	// A series of simple checks we can do without calling out to file service.
	// This is to avoid unnecessary calls to the file service which may slow things down.
	if (path === '') {
		// Dont show an error message if the path is empty. This is just the equivalent to the `.`
		// path.
		return undefined;
	}

	// Relative paths only
	if (opts.noAbsolutePaths && (path[0] === '/' || path[0] === '\\')) {
		return localize('fileNameStartsWithSlashError', "A file or folder name cannot start with a slash.");
	}

	// Combine path with parent path to check for length. Add 1 for separator.
	const pathLength = path.length + (opts.parentPath ? opts.parentPath.length + 1 : 0);
	if (pathLength > 256) {
		return localize('fileNameTooLongError', "File path is too long, must be under 256 characters.");
	}

	// Check for invalid file names
	// TODO: This may need to be changed to work with remote file systems with `remoteAgentService.getEnvironment()`
	const isWindows = OS === OperatingSystem.Windows;

	// Try and create URI to validate path. Should catch things like improper characters etc..
	let pathUri: URI;
	try {
		pathUri = URI.file(path);
	} catch (e) {
		return localize('unableToConvertToUriError', "Can't parse file name. Check for invalid characters.");
	}

	const pathBase = basename(pathUri);
	if (!isValidBasename(pathBase, isWindows)) {
		// Make the path cleaner for display
		return localize('invalidFileNameError', "{0} is not valid as a file or folder name. Please choose a different name.", sanitizePathForDisplay(pathBase));
	}

	// Check for whitespace
	if (/^\s|\s$/.test(path)) {
		return localize('fileNameWhitespaceWarning', "Leading or trailing whitespace detected in file or folder name.");
	}

	return undefined;
}

/**
 * Check if the current path exists. For use in labeled text/folder validator function.
 *
 * @see `checkIfPathValid` `useDebouncedValidator` `LabeledTextInput` `LabeledFolderInput`
 * @returns Promise with error message if path doesn't exist or undefined if it does.
 */
export async function checkIfPathExists(path: string | number, fileService: IFileService): Promise<string | undefined> {
	path = path.toString();
	try {
		const pathUri = URI.file(path);
		const pathExists = await fileService.exists(pathUri);

		if (!pathExists) {
			return localize('pathDoesNotExistError', "The path {0} does not exist.", sanitizePathForDisplay(path));
		}
	} catch (e) {
		return localize('errorCheckingIfPathExists', "An error occurred while checking if the path {0} exists.", sanitizePathForDisplay(path));
	}

	return undefined;
}

/**
 * Check if the current URI exists. For use with Positron web.
 *
 * @see `checkIfPathValid` `useDebouncedValidator` `LabeledTextInput` `LabeledFolderInput`
 * @returns Promise with error message if path doesn't exist or undefined if it does.
 */
export async function checkIfURIExists(path: URI, fileService: IFileService): Promise<string | undefined> {
	try {
		const pathExists = await fileService.exists(path);

		if (!pathExists) {
			return localize('pathDoesNotExistError', "The path {0} does not exist.", sanitizePathForDisplay(path.path));
		}
	} catch (e) {
		return localize('errorCheckingIfPathExists', "An error occurred while checking if the path {0} exists.", sanitizePathForDisplay(path.path));
	}

	return undefined;
}

/**
 * Check if the input is empty.
 * @param input The input to check if it is empty.
 * @returns Whether the input is empty.
 */
export function isInputEmpty(input: string | number): boolean {
	return typeof input === 'number' ? false : input.trim() === '';
}

/**
 * Helper function to print paths in a more readable format.
 * @param path Full path to sanitize.
 * @returns The sanitized path.
 */
function sanitizePathForDisplay(path: string): string {
	// Make the path cleaner for display
	const sanitizedPath = path.replace(/\*/g, '\\*'); // CodeQL [SM02383] This only processes filenames which are enforced against having backslashes in them farther up in the stack.

	return truncateMiddle(sanitizedPath, 55);
}
