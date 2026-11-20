/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { joinPath, isEqualOrParent } from '../../../../base/common/resources.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ExtensionsRegistry } from '../../../services/extensions/common/extensionsRegistry.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IOverlayWebview, WebviewOptions } from '../../webview/browser/webview.js';
import { INativeModuleLocation, NativeHostWebview } from './nativeHostWebview.js';

/** The setting that turns the native host on. Off by default. */
const NATIVE_HOST_ENABLED_KEY = 'webview.experimental.nativeHost';

/** The only extension allowed to run code in the workbench page. */
const TRUSTED_EXTENSION_ID = 'posit.assistant';

interface INativeWebviewViewContribution {
	readonly viewType: string;
	readonly entry: string;
}

/**
 * The `positronNativeWebviewViews` contribution point. An extension names an
 * ES module in its folder that can render a webview view directly in the
 * workbench page.
 */
ExtensionsRegistry.registerExtensionPoint<INativeWebviewViewContribution[]>({
	extensionPoint: 'positronNativeWebviewViews',
	jsonSchema: {
		description: localize('positron.nativeWebviewViews', "Contributes ES modules that render webview views and editor tabs directly in the workbench page instead of in an iframe."),
		type: 'array',
		items: {
			type: 'object',
			additionalProperties: false,
			required: ['viewType', 'entry'],
			properties: {
				viewType: {
					description: localize('positron.nativeWebviewViews.viewType', "The webview view or webview panel type the module renders."),
					type: 'string',
				},
				entry: {
					description: localize('positron.nativeWebviewViews.entry', "Path to the ES module, relative to the extension folder."),
					type: 'string',
				},
			},
		},
	},
});

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'webview',
	properties: {
		[NATIVE_HOST_ENABLED_KEY]: {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.APPLICATION,
			tags: ['experimental'],
			description: localize('positron.webview.experimental.nativeHost', "Render Posit Assistant's sidebar and editor tabs directly in the workbench page instead of in a webview. Applies to views opened after the change."),
		},
	},
});

export const IPositronNativeWebviewHostService = createDecorator<IPositronNativeWebviewHostService>('positronNativeWebviewHostService');

export interface IPositronNativeWebviewHostService {
	readonly _serviceBrand: undefined;

	/**
	 * Returns a native webview for a webview view or editor tab when the
	 * setting is on and a trusted extension contributes a module for its view
	 * type. Otherwise returns undefined, and the caller creates a normal webview.
	 */
	tryCreateWebviewOverlay(viewType: string | undefined, extensionId: ExtensionIdentifier | undefined, options: WebviewOptions): IOverlayWebview | undefined;
}

class PositronNativeWebviewHostService implements IPositronNativeWebviewHostService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) { }

	tryCreateWebviewOverlay(viewType: string | undefined, extensionId: ExtensionIdentifier | undefined, options: WebviewOptions): IOverlayWebview | undefined {
		if (!viewType || this._configurationService.getValue<boolean>(NATIVE_HOST_ENABLED_KEY) !== true) {
			return undefined;
		}
		if (!extensionId || !ExtensionIdentifier.equals(extensionId, TRUSTED_EXTENSION_ID)) {
			return undefined;
		}
		const extension = this._extensionService.extensions.find(e => ExtensionIdentifier.equals(e.identifier, extensionId));
		let location: Promise<INativeModuleLocation | undefined>;
		if (extension) {
			const resolved = this._getModuleLocation(extension, viewType);
			if (!resolved) {
				return undefined;
			}
			location = Promise.resolve(resolved);
		} else {
			// Editor tabs restored at startup are created before extension
			// manifests are read. The extension is trusted, so commit to the
			// native host now and find the module once manifests are read.
			location = this._extensionService.whenInstalledExtensionsRegistered().then(() => {
				const registered = this._extensionService.extensions.find(e => ExtensionIdentifier.equals(e.identifier, extensionId));
				return registered ? this._getModuleLocation(registered, viewType) : undefined;
			});
		}

		this._logService.info(`[NativeHostWebview] Rendering ${viewType} natively`);
		return this._instantiationService.createInstance(NativeHostWebview, {
			providedViewType: viewType,
			options,
			extension: { id: extensionId },
			location,
		});
	}

	private _getModuleLocation(extension: IExtensionDescription, viewType: string): INativeModuleLocation | undefined {
		const contribution = getNativeWebviewViewContributions(extension).find(c => c.viewType === viewType);
		if (!contribution) {
			return undefined;
		}
		const moduleUri = joinPath(extension.extensionLocation, contribution.entry);
		if (!isEqualOrParent(moduleUri, extension.extensionLocation)) {
			this._logService.warn(`[NativeHostWebview] Entry ${contribution.entry} is outside the extension folder.`);
			return undefined;
		}
		return { extensionLocation: extension.extensionLocation, moduleUri };
	}
}

function getNativeWebviewViewContributions(extension: IExtensionDescription): INativeWebviewViewContribution[] {
	const contributions = (extension.contributes as { positronNativeWebviewViews?: unknown } | undefined)?.positronNativeWebviewViews;
	if (!Array.isArray(contributions)) {
		return [];
	}
	return contributions.filter((c): c is INativeWebviewViewContribution =>
		typeof c?.viewType === 'string' && typeof c?.entry === 'string');
}

registerSingleton(IPositronNativeWebviewHostService, PositronNativeWebviewHostService, InstantiationType.Delayed);
