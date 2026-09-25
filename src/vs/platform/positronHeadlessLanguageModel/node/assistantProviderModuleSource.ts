/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from '../../../base/common/path.js';
import { areSameExtensions } from '../../extensionManagement/common/extensionManagementUtil.js';
import { IExtensionManagementService, IGlobalExtensionEnablementService } from '../../extensionManagement/common/extensionManagement.js';
import { ExtensionType } from '../../extensions/common/extensions.js';

const ASSISTANT_EXTENSION_ID = 'posit.assistant';
const PROVIDER_MODULE_FOLDER = 'provider-module';

/** Where to find Assistant's provider module on disk, or why there isn't one. */
export type AssistantProviderModuleSource =
	| { readonly folder: string; readonly enabled: true }
	| { readonly folder: string; readonly enabled: false };

/**
 * Finds posit.assistant's installed provider module folder, purely from
 * on-disk install and enablement records -- no extension host involved.
 * Returns undefined when the extension isn't installed.
 */
export async function findAssistantProviderModule(
	extensions: IExtensionManagementService,
	enablement: IGlobalExtensionEnablementService,
): Promise<AssistantProviderModuleSource | undefined> {
	const installed = await extensions.getInstalled(ExtensionType.User);
	const assistant = installed.find(extension => areSameExtensions(extension.identifier, { id: ASSISTANT_EXTENSION_ID }));
	if (!assistant) {
		return undefined;
	}

	const folder = join(assistant.location.fsPath, 'dist', PROVIDER_MODULE_FOLDER);
	const disabled = enablement.getDisabledExtensions().some(id => areSameExtensions(id, { id: ASSISTANT_EXTENSION_ID }));
	return disabled ? { folder, enabled: false } : { folder, enabled: true };
}
