/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize } from '../../../../nls.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IResourceDiffEditorInput } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { setImportWasPrompted } from './helpers.js';


export class PositronImportSettings extends Action2 {
	/**
	 * The action ID.
	 */
	static readonly ID = 'positron.workbench.action.importSettings';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronImportSettings.ID,
			title: {
				value: localize('positronImportSettings', "Import Settings..."),
				original: 'Import Settings...'
			},
			category: 'Preferences',
			f1: true,
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 */
	override async run(accessor: ServicesAccessor): Promise<void> {
		const pathService = accessor.get(IPathService);
		const fileService = accessor.get(IFileService);
		const editorService = accessor.get(IEditorService);
		const prefService = accessor.get(IPreferencesService);

		const positronSettingsPath = await prefService.getEditableSettingsURI(ConfigurationTarget.USER);
		if (!positronSettingsPath) {
			alert('No Positron settings found');
			return;
		}

		const positronSettingsContent = await fileService
			.readFile(positronSettingsPath)
			.then(content => content.value.toString());
		const positronData = JSON.parse(positronSettingsContent);

		if (!positronData) {
			alert('No Positron settings found');
			return;
		}

		const codeSettingsPath = await this.getCodeSettingsPath(pathService);
		const codeSettingsContent = await fileService
			.readFile(codeSettingsPath)
			.then(content => content.value.toString());
		const codeData = JSON.parse(codeSettingsContent);

		if (!codeData) {
			alert('No Code settings found');
			return;
		}

		const orderedPositronData = Object.keys(positronData).sort().reduce(
			(obj, key) => {
				obj[key] = positronData[key];
				return obj;
			},
			{} as any
		);

		const orderedCodeData = Object.keys(codeData).sort().reduce(
			(obj, key) => {
				obj[key] = codeData[key];
				return obj;
			},
			{} as any
		);



		const input: IResourceDiffEditorInput = {
			original: { resource: undefined, contents: JSON.stringify(orderedPositronData, null, 2), label: 'Positron Settings', options: { transient: true } },
			modified: { resource: undefined, contents: JSON.stringify(orderedCodeData, null, 2), label: 'Visual Studio Code Settings', options: { transient: true } },
		};

		await editorService.openEditor(input);

	}



	private async getCodeSettingsPath(pathService: IPathService): Promise<URI> {
		const path = await pathService.path;
		const homedir = await pathService.userHome();

		let appDataPath: URI;
		switch (platform.OS) {
			case platform.OperatingSystem.Windows:
				if (process.env['APPDATA']) {
					appDataPath = URI.parse(process.env['APPDATA']);
				} else {
					const userProfile = process.env['USERPROFILE'];
					if (typeof userProfile !== 'string') {
						throw new Error('Windows: Unexpected undefined %USERPROFILE% environment variable');
					}

					appDataPath = URI.parse(path.join(userProfile, 'AppData', 'Roaming'));
				}
				break;
			case platform.OperatingSystem.Macintosh:
				appDataPath = homedir.with({ path: path.join(homedir.path, 'Library', 'Application Support') });
				break;
			case platform.OperatingSystem.Linux:
				appDataPath = process.env['XDG_CONFIG_HOME'] ? URI.parse(process.env['XDG_CONFIG_HOME']) : homedir.with({ path: path.join(homedir.path, '.config') });
				break;
			default:
				throw new Error('Platform not supported');
		}

		return appDataPath.with({ path: path.join(appDataPath.path, 'Code', 'User', 'settings.json') });
	}
}

export class ResetPositronImportPrompt extends Action2 {
	static readonly ID = 'positron.workbench.action.resetImportPrompt';

	constructor() {
		super({
			id: ResetPositronImportPrompt.ID,
			title: {
				value: localize('positronResetImportPrompt', "Reset Import Settings Prompt"),
				original: 'Reset Import Settings Prompt'
			},
			category: 'Preferences',
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const storageService = accessor.get(IStorageService);
		setImportWasPrompted(storageService, false);
	}
}
