/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainPositronContext, MainThreadEnvironmentShape } from '../../common/positron/extHost.positron.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IEnvironmentVariableService } from '../../../contrib/terminal/common/environmentVariable.js';
import { EnvironmentContributionFilter } from '../../common/positron/extHostTypes.positron.js';
import { IProcessEnvironment } from '../../../../base/common/platform.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IEnvironmentVariableCollection } from '../../../../platform/terminal/common/environmentVariable.js';
import { MergedEnvironmentVariableCollection } from '../../../../platform/terminal/common/environmentVariableCollection.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationResolverService } from '../../../services/configurationResolver/common/configurationResolver.js';
import { createVariableResolver } from '../../../contrib/terminal/common/terminalEnvironment.js';

interface IEnvironmentVariableAction {
	/** The action to take */
	action: number;

	/** The name of the variable */
	name: string;

	/** The value to replace, append, or remove */
	value: string;
}

@extHostNamedCustomer(MainPositronContext.MainThreadEnvironment)
export class MainThreadEnvironment implements MainThreadEnvironmentShape {

	private readonly _disposables = new DisposableStore();
	constructor(
		extHostContext: IExtHostContext,
		@IEnvironmentVariableService private readonly _environmentService: IEnvironmentVariableService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IConfigurationResolverService private readonly _configurationResolverService: IConfigurationResolverService,
	) {
	}

	async $getEnvironmentContributions(filter?: EnvironmentContributionFilter): Promise<Record<string, IEnvironmentVariableAction[]>> {
		// Get environment variable collections from the environment service
		const collections = this._environmentService.collections;

		// Create a new map to store the results
		const result = Object.create(null) as Record<string, IEnvironmentVariableAction[]>;

		// Iterate through collections and extract environment variable actions
		for (const [extensionIdentifier, collection] of collections.entries()) {
			const actions: IEnvironmentVariableAction[] = [];
			for (const [variable, mutator] of collection.map) {
				// When filtering to process creation, skip mutators that opt out
				// of it. These are contributed for interactive terminals only
				// (applied via shell integration) and must not be inherited by
				// spawned runtime processes such as kernels. Without a filter,
				// every contribution is returned so terminal-like consumers can
				// replay shell-integration-only variables too.
				if (filter === EnvironmentContributionFilter.ProcessCreation &&
					mutator.options?.applyAtProcessCreation === false) {
					continue;
				}
				actions.push({
					action: mutator.type,
					name: variable,
					value: mutator.value
				});
			}
			result[extensionIdentifier] = actions;
		}

		return result;
	}

	async $resolveEnvironmentContributions(baseEnv: IProcessEnvironment, workspaceFolderUri: UriComponents | undefined, excludeExtensions: readonly string[]): Promise<IProcessEnvironment> {
		const uri = workspaceFolderUri && URI.revive(workspaceFolderUri);
		// Only a folder open in the workspace scopes contributions; otherwise only global ones apply.
		const workspaceFolder = uri && this._workspaceContextService.getWorkspace().folders.find(f => isEqual(f.uri, uri));
		const excluded = new Set(excludeExtensions.map(id => ExtensionIdentifier.toKey(id)));
		const collections = new Map<string, IEnvironmentVariableCollection>();
		for (const [extensionId, collection] of this._environmentService.collections) {
			if (excluded.has(ExtensionIdentifier.toKey(extensionId))) {
				continue;
			}
			// The environment is for processes without shell integration, so contributions
			// terminals apply through it are applied directly.
			const map = new Map([...collection.map].map(([key, m]) => [key, { ...m, options: { applyAtProcessCreation: true, applyAtShellIntegration: false } }]));
			collections.set(extensionId, { map });
		}

		const env = { ...baseEnv };
		const resolver = createVariableResolver(workspaceFolder, { ...baseEnv }, this._configurationResolverService);
		await new MergedEnvironmentVariableCollection(collections).applyToProcessEnvironment(env, { workspaceFolder }, resolver && (async value => {
			try {
				return await resolver(value);
			} catch {
				// Leave a reference that can't be resolved, such as `${workspaceFolder}` without a folder.
				return value;
			}
		}));
		return env;
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
