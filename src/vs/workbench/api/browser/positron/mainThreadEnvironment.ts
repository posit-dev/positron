/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEnvironmentVariableContributionDto, MainPositronContext, MainThreadEnvironmentShape } from '../../common/positron/extHost.positron.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IEnvironmentVariableCollectionWithPersistence, IEnvironmentVariableService } from '../../../contrib/terminal/common/environmentVariable.js';
import { EnvironmentContributionFilter } from '../../common/positron/extHostTypes.positron.js';
import { EnvironmentVariableScope, IEnvironmentVariableMutator } from '../../../../platform/terminal/common/environmentVariable.js';

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
		@IEnvironmentVariableService private readonly _environmentService: IEnvironmentVariableService
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

	async $getEnvironmentVariableContributions(): Promise<IEnvironmentVariableContributionDto[]> {
		const folderIndex = (scope: EnvironmentVariableScope | undefined) => scope?.workspaceFolder?.index;
		const keyOf = (extensionId: string, m: IEnvironmentVariableMutator) =>
			`${extensionId}\0${m.variable}\0${folderIndex(m.scope) ?? ''}`;

		// Every contribution, with its collection's details.
		const all = new Map<string, IEnvironmentVariableContributionDto>();
		const scopes = new Map<number | undefined, EnvironmentVariableScope | undefined>([[undefined, undefined]]);
		for (const [extensionId, collection] of this._environmentService.collections) {
			const descriptions = [...collection.descriptionMap?.values() ?? []];
			for (const m of collection.map.values()) {
				const folder = m.scope?.workspaceFolder;
				scopes.set(folder?.index, m.scope);
				all.set(keyOf(extensionId, m), {
					extensionId,
					variable: m.variable,
					type: m.type,
					value: m.value,
					applyAtProcessCreation: m.options?.applyAtProcessCreation ?? true,
					applyAtShellIntegration: m.options?.applyAtShellIntegration ?? false,
					workspaceFolder: folder && { uri: folder.uri, name: folder.name, index: folder.index },
					description: descriptions.find(d => folderIndex(d.scope) === folder?.index)?.description,
					// The service stores collections with persistence; its interface doesn't say so.
					persistent: (collection as Partial<IEnvironmentVariableCollectionWithPersistence>).persistent === true,
					applied: false,
				});
			}
		}

		// The merged collection holds the contributions terminals apply, in order.
		const result: IEnvironmentVariableContributionDto[] = [];
		const merged = this._environmentService.mergedCollection;
		for (const [index, scope] of scopes) {
			for (const mutators of merged.getVariableMap(scope).values()) {
				for (const m of mutators) {
					const contribution = folderIndex(m.scope) === index ? all.get(keyOf(m.extensionIdentifier, m)) : undefined;
					if (contribution && !contribution.applied) {
						contribution.applied = true;
						result.push(contribution);
					}
				}
			}
		}
		for (const contribution of all.values()) {
			if (!contribution.applied) {
				result.push(contribution);
			}
		}
		return result;
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
