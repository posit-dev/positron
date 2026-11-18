/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPositronPreviewService, POSITRON_VIEWER_USE_INTEGRATED_BROWSER } from '../browser/positronPreviewSevice.js';
import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ElectronPositronPreviewService } from './positronPreviewServiceImpl.js';

// Register the Electron variant of the Positron preview service.
registerSingleton(IPositronPreviewService, ElectronPositronPreviewService, InstantiationType.Delayed);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'positron',
	properties: {
		[POSITRON_VIEWER_USE_INTEGRATED_BROWSER]: {
			scope: ConfigurationScope.APPLICATION,
			type: 'boolean',
			default: false,
			description: localize('positron.viewer.useIntegratedBrowser', "Show web pages and HTML in the Viewer using the integrated browser. When off, the Viewer uses a webview.")
		},
	}
});
