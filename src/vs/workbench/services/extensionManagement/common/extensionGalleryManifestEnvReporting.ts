/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { toAction } from '../../../../base/common/actions.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ExtensionGalleryConfig } from '../../../../platform/extensionManagement/common/extensionGalleryManifestService.js';
import { parseExtensionsGalleryEnv } from '../../../../platform/extensionManagement/common/extensionsGalleryEnv.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { showWindowLogActionId } from '../../../services/log/common/logConstants.js';

/**
 * Parses the EXTENSIONS_GALLERY value and reports the outcome to the user:
 * a warning notification + log on parse failure, an info log on success.
 *
 * Shared by the desktop (electron-browser) and web (browser) gallery manifest
 * services. On desktop the value comes from the local process env; on web it is
 * forwarded by the server (the browser cannot read process env), so both can run
 * identical parse/report/precedence logic. Exported for unit testing -- the host
 * classes wire services in.
 */
export function reportExtensionsGalleryEnv(
	envValue: string | undefined,
	gallerySource: string | undefined,
	logService: Pick<ILogService, 'info' | 'warn'>,
	notificationService: Pick<INotificationService, 'notify'>,
	openLog: () => void,
): ExtensionGalleryConfig | undefined {
	if (!envValue) {
		return undefined;
	}
	const parsed = parseExtensionsGalleryEnv<ExtensionGalleryConfig>(envValue, msg => {
		logService.warn(msg);
		notificationService.notify({
			severity: Severity.Warning,
			message: localize(
				'positron.extensionsGallery.envInvalid',
				"The EXTENSIONS_GALLERY environment variable is set but is not valid. The extension gallery source setting (positron.extensions.gallerySource), currently \"{0}\", will be used instead. See the log for details.",
				gallerySource ?? ''),
			actions: {
				primary: [
					toAction({
						id: 'positron.extensionsGallery.showLog',
						label: localize('positron.extensionsGallery.showLog', "Show Window Log"),
						run: () => openLog(),
					})
				]
			}
		});
	});
	if (parsed) {
		logService.info(`[Marketplace] Using extension gallery from EXTENSIONS_GALLERY env var: ${parsed.serviceUrl}`);
	}
	return parsed;
}

/**
 * Decides what happens when the Positron gallery source setting changes. Only a
 * successfully-parsed EXTENSIONS_GALLERY env var overrides the setting, so notify
 * the user that the change won't take effect and skip the restart prompt in that
 * case; otherwise (env var unset or malformed) the setting applies, so request a
 * restart. Exported for unit testing -- the host classes wire services in.
 */
export function handleGallerySourceSettingChange(
	envGallery: ExtensionGalleryConfig | undefined,
	notificationService: Pick<INotificationService, 'info'>,
	requestRestart: () => void,
): void {
	if (envGallery) {
		notificationService.info(localize(
			'positron.extensionsGallery.settingIgnoredByEnv',
			"The EXTENSIONS_GALLERY environment variable is set and overrides the extension gallery source setting. Unset the environment variable for this setting to take effect."));
		return;
	}
	requestRestart();
}

/**
 * Reveals the Window log channel. ICommandService is resolved lazily rather than
 * injected because the gallery manifest service sits below the command-service
 * layer in the DI graph (commandService -> extensionService ->
 * extensionGalleryService -> gallery manifest service); injecting it directly
 * forms a cyclic dependency. Shared by the desktop and web services.
 */
export function showWindowLog(instantiationService: IInstantiationService): void {
	instantiationService.invokeFunction(accessor => accessor.get(ICommandService).executeCommand(showWindowLogActionId));
}
