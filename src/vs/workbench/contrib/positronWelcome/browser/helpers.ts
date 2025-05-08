/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { PositronImportSettings } from './actions.js';
import * as platform from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { env } from '../../../../base/common/process.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { parse } from '../../../../base/common/jsonc.js';

const WAS_PROMPTED_KEY = 'positron.welcome.promptedImport';

export async function getImportWasPrompted(
	storageService: IStorageService,
): Promise<boolean> {
	return storageService.getBoolean(WAS_PROMPTED_KEY, StorageScope.PROFILE, false);
}

export function setImportWasPrompted(
	storageService: IStorageService,
	state: boolean = true
) {
	storageService.store(WAS_PROMPTED_KEY, state, StorageScope.PROFILE, StorageTarget.MACHINE);
}

export async function promptImport(
	storageService: IStorageService,
	notificationService: INotificationService,
	commandService: ICommandService,
) {
	// Show the prompt to the user.
	// The prompt will show up in the notification center.
	notificationService.prompt(
		Severity.Info,
		localize('positron.settingsImport.prompt', 'Import your settings from Visual Studio Code into Positron?'),
		[
			// Open the import settings command and set the import was prompted flag to true.
			// This will prevent the prompt from showing up again.
			{
				label: localize('positron.settingsImport.import', 'Import'),
				run: () => {
					commandService.executeCommand(PositronImportSettings.ID);
					setImportWasPrompted(storageService);
				},
			},
			// Dismisses notification, but will prompt again on next launch.
			{
				label: localize('positron.settingsImport.later', 'Later'),
				run: () => { },
			},
			// Adds a "Don't show again" action to the prompt.
			// This will allow the user to dismiss the prompt and not show it again.
			{
				label: localize('positron.settingsImport.dontShowAgain', "Don't show again"),
				run: () => {
					setImportWasPrompted(storageService);
				},
			}
		],
		{
			sticky: true,
			onCancel: () => { },
		}
	);
}

export async function getCodeSettingsPath(
	pathService: IPathService, os: platform.OperatingSystem = platform.OS): Promise<URI> {
	const path = await pathService.path;
	const homedir = await pathService.userHome();

	switch (os) {
		case platform.OperatingSystem.Windows:
			if (env['APPDATA']) {
				return URI.file(path.join(env['APPDATA'], 'Code', 'User', 'settings.json'));
			} else if (env['USERPROFILE']) {
				const userProfile = env['USERPROFILE'];
				return URI.file(path.join(userProfile, 'AppData', 'Roaming', 'Code', 'User', 'settings.json'));
			} else {
				return URI.joinPath(homedir, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
			}

		case platform.OperatingSystem.Macintosh:
			return URI.joinPath(homedir, 'Library', 'Application Support', 'Code', 'User', 'settings.json');

		case platform.OperatingSystem.Linux:
			return URI.joinPath(
				(env['XDG_CONFIG_HOME'] ?
					URI.file(env['XDG_CONFIG_HOME']) :
					URI.joinPath(homedir, '.config')
				), 'Code', 'User', 'settings.json'
			);

		default:
			throw new Error('Platform not supported');
	}

	// TODO @samclark2015: workbench
	// Check ENV variable for the path to the settings file
	// Also check default location (~/.vscode-server/User/settings.json)
}

/**
 * Merge two JSON settings files.
 * Returns the merged settings as a string with git merge conflict markers.
 *
 * @param fileService File service to read the files
 * @param existing URI to existing settings file
 * @param incoming URI to incoming settings file
 * @returns Merged settings JSON as a string
 */
export async function mergeSettingsJson(
	fileService: IFileService,
	existing: URI,
	incoming: URI
): Promise<string> {
	// Read the contents of the existing and incoming settings files
	const existingContents = await fileService.readFile(existing);
	const incomingContents = await fileService.readFile(incoming);

	// Parse the contents as JSON
	// Using the `jsonc.parse` function to handle comments and trailing commas
	const existingJson = parse<Record<string, any>>(existingContents.value.toString());
	const incomingJson = parse<Record<string, any>>(incomingContents.value.toString());

	// Merge the two JSON objects
	const mergedJson = mergeObjects(existingJson, incomingJson);
	// Serialize the merged JSON object to a string with git merge conflict markers
	const serializedOutput = serializeWithMergeMarkers(mergedJson);
	return serializedOutput;
}

/**
 * Merges two objects, optionally handling nested objects recursively.
 * In case of conflicts, it marks them using a special structure for later serialization.
 *
 * @param existing The existing object to merge.
 * @param incoming The incoming object to merge.
 * @returns The merged object with conflicts marked.
 */
function mergeObjects(existing: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
	const merged: Record<string, any> = {};
	// Create a set of all keys from both objects
	const allKeys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);

	for (const key of allKeys) {
		if (key in existing && key in incoming) {
			// The key exists in both objects
			if (
				typeof existing[key] === 'object' &&
				typeof incoming[key] === 'object' &&
				!Array.isArray(existing[key]) &&
				!Array.isArray(incoming[key]) &&
				existing[key] !== null &&
				incoming[key] !== null
			) {
				// Both values are objects, so we need to merge them recursively
				// and mark the conflict if it exists
				merged[key] = mergeObjects(existing[key], incoming[key]);
			} else if (
				JSON.stringify(existing[key]) !== JSON.stringify(incoming[key])
			) {
				// Otherwise, if a scalar or array with different values, mark as conflict
				merged[key] = {
					conflict: true,
					existing: existing[key],
					incoming: incoming[key]
				};
			} else {
				// If the values are the same, just take one of them
				merged[key] = existing[key];
			}
		} else if (key in existing) {
			// The key exists only in the existing object
			merged[key] = existing[key];
		} else if (key in incoming) {
			// The key exists only in the incoming object
			merged[key] = incoming[key];
		}
	}

	return merged;
}

/**
 * Serializes a JSON object to a string, adding git merge conflict markers
 * for conflicting keys.
 *
 * @param json The JSON object to serialize.
 * @param level The current indentation level (used for nested objects).
 * @returns The serialized JSON string with merge markers.
 */
function serializeWithMergeMarkers(json: Record<string, any>, level: number = 1): string {
	// Start with opening brace for the top level
	let result = (level === 1) ? '{\n' : '';
	// Get all keys in the object
	const keys = Object.keys(json);

	// The proper indentation for all keys, including top-level
	const keyIndent = '\t'.repeat(level);

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const value = json[key];

		// Serialize the key back into JSON-friendly format
		const serializedKey = JSON.stringify(key);
		const isLastKey = i === keys.length - 1;
		// End with a comma if not the last line
		const lineEnd = isLastKey ? '' : ',';

		if (typeof value === 'object' && value !== null && value.conflict) {
			// This is a conflict, so we need to serialize it with merge markers
			// Serialize the existing and incoming values
			// making sure to indent them properly
			const serializedExisting = JSON.stringify(value.existing, null, '\t')
				.replace(
					/\n/g,
					'\n' + '\t'.repeat(level)
				);
			const serializedIncoming = JSON.stringify(value.incoming, null, '\t')
				.replace(
					/\n/g,
					'\n' + '\t'.repeat(level)
				);

			// Add the merge markers
			result += `<<<<<<< Existing\n`;
			result += `${keyIndent}${serializedKey}: ${serializedExisting}${lineEnd}\n`;
			result += `=======\n`;
			result += `${keyIndent}${serializedKey}: ${serializedIncoming}${lineEnd}\n`;
			result += `>>>>>>> Incoming\n`;
		} else if (Array.isArray(value) || typeof value !== 'object') {
			// This is a simple value or an array, so we can serialize it directly
			const serializedValue = JSON.stringify(value, null, '\t')
				.replace(
					/\n/g,
					'\n' + '\t'.repeat(level)
				);
			result += `${keyIndent}${serializedKey}: ${serializedValue}${lineEnd}\n`;
		} else {
			// This is a nested object, so we need to serialize it recursively
			result += `${keyIndent}${serializedKey}: {\n`;
			result += serializeWithMergeMarkers(value, level + 1);
			result += `${keyIndent}}${lineEnd}\n`;
		}
	}


	// Add closing brace with proper indentation for top level
	return (level === 1) ? result + '}' : result;
}
