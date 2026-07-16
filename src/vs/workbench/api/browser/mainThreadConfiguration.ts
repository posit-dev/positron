/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, getScopes } from '../../../platform/configuration/common/configurationRegistry.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../platform/workspace/common/workspace.js';
import { MainThreadConfigurationShape, MainContext, ExtHostContext, IConfigurationInitData } from '../common/extHost.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { ConfigurationTarget, IConfigurationService, IConfigurationOverrides } from '../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
// --- Start Positron ---
import * as nls from '../../../nls.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { Extensions as ConfigurationMigrationExtensions, IConfigurationMigrationRegistry, ConfigurationKeyValuePairs } from '../../common/configuration.js';
// --- End Positron ---

@extHostNamedCustomer(MainContext.MainThreadConfiguration)
export class MainThreadConfiguration implements MainThreadConfigurationShape {

	private readonly _configurationListener: IDisposable;

	constructor(
		extHostContext: IExtHostContext,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
		// --- Start Positron ---
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IProductService private readonly _productService: IProductService,
		// --- End Positron ---
	) {
		const proxy = extHostContext.getProxy(ExtHostContext.ExtHostConfiguration);

		proxy.$initializeConfiguration(this._getConfigurationData());
		this._configurationListener = configurationService.onDidChangeConfiguration(e => {
			proxy.$acceptConfigurationChanged(this._getConfigurationData(), e.change);
		});
	}

	private _getConfigurationData(): IConfigurationInitData {
		const configurationData: IConfigurationInitData = { ...(this.configurationService.getConfigurationData()!), configurationScopes: [] };
		// Send configurations scopes only in development mode.
		if (!this._environmentService.isBuilt || this._environmentService.isExtensionDevelopment) {
			configurationData.configurationScopes = getScopes();
		}
		return configurationData;
	}

	// --- Start Positron ---
	$registerConfigurationMigrations(extensionId: string, migrations: ReadonlyArray<{ readonly key: string; readonly migrateTo: string }>): void {
		const configurationProperties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
		const normalizedExtensionId = extensionId.toLowerCase();
		const publisher = normalizedExtensionId.split('.')[0];
		const isTrusted = (this._productService.trustedExtensionPublishers ?? []).includes(publisher);

		const approved = migrations.filter(migration => {
			const source = configurationProperties[migration.key]?.source;
			const sourceId = (source && typeof source !== 'string')
				? source.id.toLowerCase()
				: undefined;
			const isRegisteredOwner = sourceId === normalizedExtensionId;
			// When the key has no extension owner (unregistered after a rename, or never attributed),
			// accept ownership if the key falls within the extension's namespace.
			const isNamespaceOwner = sourceId === undefined && migration.key.toLowerCase().startsWith(normalizedExtensionId + '.');
			const isOwner = isRegisteredOwner || isNamespaceOwner;
			if (!isOwner && !isTrusted) {
				this._logService.warn(`Extension '${extensionId}' attempted to register a configuration migration for '${migration.key}' but does not own it.`);
				return false;
			}
			return true;
		});

		const policyConflicts = approved.filter(migration => {
			const oldPolicyValue = this.configurationService.inspect(migration.key)?.policyValue;
			const newPolicyValue = this.configurationService.inspect(migration.migrateTo)?.policyValue;
			return oldPolicyValue !== undefined && newPolicyValue === undefined;
		});

		for (const migration of policyConflicts) {
			this._logService.error(
				`Admin policy enforces '${migration.key}' but not '${migration.migrateTo}'. ` +
				`Migration registered by '${extensionId}' may not behave correctly.`
			);
		}

		if (policyConflicts.length > 0) {
			const keyList = policyConflicts.map(m => `'${m.key}'`).join(', ');
			this._notificationService.notify({
				severity: Severity.Warning,
				message: nls.localize(
					'positron.configurationMigration.policyConflict',
					"Some configuration migrations registered by '{0}' are blocked by system policy ({1}). Contact your administrator to update the policy.",
					extensionId,
					keyList,
				),
			});
		}

		if (approved.length > 0) {
			Registry.as<IConfigurationMigrationRegistry>(ConfigurationMigrationExtensions.ConfigurationMigration)
				.registerConfigurationMigrations(approved.map(migration => ({
					key: migration.key,
					migrateFn: (value: unknown, accessor: (key: string) => unknown): ConfigurationKeyValuePairs => {
						const pairs: ConfigurationKeyValuePairs = [[migration.key, { value: undefined }]];
						if (value !== undefined && accessor(migration.migrateTo) === undefined) {
							pairs.push([migration.migrateTo, { value }]);
						}
						return pairs;
					},
				})));
		}
	}
	// --- End Positron ---

	public dispose(): void {
		this._configurationListener.dispose();
	}

	$updateConfigurationOption(target: ConfigurationTarget | null, key: string, value: unknown, overrides: IConfigurationOverrides | undefined, scopeToLanguage: boolean | undefined): Promise<void> {
		overrides = { resource: overrides?.resource ? URI.revive(overrides.resource) : undefined, overrideIdentifier: overrides?.overrideIdentifier };
		return this.writeConfiguration(target, key, value, overrides, scopeToLanguage);
	}

	$removeConfigurationOption(target: ConfigurationTarget | null, key: string, overrides: IConfigurationOverrides | undefined, scopeToLanguage: boolean | undefined): Promise<void> {
		overrides = { resource: overrides?.resource ? URI.revive(overrides.resource) : undefined, overrideIdentifier: overrides?.overrideIdentifier };
		return this.writeConfiguration(target, key, undefined, overrides, scopeToLanguage);
	}

	private writeConfiguration(target: ConfigurationTarget | null, key: string, value: unknown, overrides: IConfigurationOverrides, scopeToLanguage: boolean | undefined): Promise<void> {
		target = target !== null && target !== undefined ? target : this.deriveConfigurationTarget(key, overrides);
		const configurationValue = this.configurationService.inspect(key, overrides);
		switch (target) {
			case ConfigurationTarget.MEMORY:
				return this._updateValue(key, value, target, configurationValue?.memory?.override, overrides, scopeToLanguage);
			case ConfigurationTarget.WORKSPACE_FOLDER:
				return this._updateValue(key, value, target, configurationValue?.workspaceFolder?.override, overrides, scopeToLanguage);
			case ConfigurationTarget.WORKSPACE:
				return this._updateValue(key, value, target, configurationValue?.workspace?.override, overrides, scopeToLanguage);
			case ConfigurationTarget.USER_REMOTE:
				return this._updateValue(key, value, target, configurationValue?.userRemote?.override, overrides, scopeToLanguage);
			default:
				return this._updateValue(key, value, target, configurationValue?.userLocal?.override, overrides, scopeToLanguage);
		}
	}

	private _updateValue(key: string, value: unknown, configurationTarget: ConfigurationTarget, overriddenValue: unknown | undefined, overrides: IConfigurationOverrides, scopeToLanguage: boolean | undefined): Promise<void> {
		overrides = scopeToLanguage === true ? overrides
			: scopeToLanguage === false ? { resource: overrides.resource }
				: overrides.overrideIdentifier && overriddenValue !== undefined ? overrides
					: { resource: overrides.resource };
		return this.configurationService.updateValue(key, value, overrides, configurationTarget, { donotNotifyError: true });
	}

	private deriveConfigurationTarget(key: string, overrides: IConfigurationOverrides): ConfigurationTarget {
		if (overrides.resource && this._workspaceContextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			const configurationProperties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
			if (configurationProperties[key] && (configurationProperties[key].scope === ConfigurationScope.RESOURCE || configurationProperties[key].scope === ConfigurationScope.LANGUAGE_OVERRIDABLE)) {
				return ConfigurationTarget.WORKSPACE_FOLDER;
			}
		}
		return ConfigurationTarget.WORKSPACE;
	}
}
