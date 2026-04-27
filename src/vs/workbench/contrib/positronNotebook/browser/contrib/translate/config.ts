/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../nls.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../../platform/registry/common/platform.js';

export const POSITRON_NOTEBOOK_TRANSLATE_ENABLED_KEY = 'positron.notebook.translate.enabled';

const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({
	id: 'positron.notebook.translate',
	order: 8,
	title: localize('positronNotebookTranslateConfigurationTitle', "Positron Notebook Translation"),
	type: 'object',
	properties: {
		[POSITRON_NOTEBOOK_TRANSLATE_ENABLED_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.notebook.translate.enabled',
				'Enable notebook markdown cell translation. Translates markdown cells between English and supported languages, creating a new translated notebook file.'
			),
			scope: ConfigurationScope.WINDOW,
			tags: ['experimental'],
		},
	},
});
