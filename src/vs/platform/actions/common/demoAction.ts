/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../nls.js';
import { Categories } from '../../action/common/actionCommonCategories.js';
import { Action2 } from './actions.js';
import { ServicesAccessor } from '../../instantiation/common/instantiation.js';
import { URI } from '../../../base/common/uri.js';
import { ICommandService } from '../../commands/common/commands.js';
// import { IQuickInputService } from '../../quickinput/common/quickInput.js';

export class ImportSettingsAction extends Action2 {

	constructor() {
		super({
			id: 'positron.settings.import',
			title: localize2('positron.settings.import', "Import VSCode Settings"),
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// const quickInputService = accessor.get(IQuickInputService);
		const commandService = accessor.get(ICommandService);

		// const result = await quickInputService.pick([{ label: 'Yes', id: 'yes' }, { label: 'No', id: 'no' }], { canPickMany: false, title: 'This may overwrite Positron settings. Continue?' });
		// if (result?.id !== 'yes') {
		// 	return;
		// }

		// alert(result?.label);
		confirm('Overwrite settings?');

		const positronUri = URI.parse('file:///Users/sclark/.vscode-oss-dev/User/settings.json');
		const codeUri = URI.parse('file:///Users/sclark/Library/Application Support/Code/User/settings.json');

		commandService.executeCommand('vscode.diff', positronUri, codeUri, { preview: false });

	}
}
