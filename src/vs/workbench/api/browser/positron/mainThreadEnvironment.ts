/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainPositronContext, MainThreadEnvironmentShape } from '../../common/positron/extHost.positron.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IEnvironmentVariableService } from '../../../contrib/terminal/common/environmentVariable.js';

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

	async $getEnvironmentContributions(): Promise<Record<string, IEnvironmentVariableAction[]>> {
		// Get environment variable collections from the environment service
		const collections = this._environmentService.collections;

		// Create a new map to store the results
		const result = Object.create(null) as Record<string, IEnvironmentVariableAction[]>;

		// Iterate through collections and extract environment variable actions
		for (const [extensionIdentifier, collection] of collections.entries()) {
			const actions: IEnvironmentVariableAction[] = [];
			for (const [variable, action] of collection.map) {
				actions.push({
					action: action.type,
					name: variable,
					value: action.value
				});
			}
			result[extensionIdentifier] = actions;
		}

		return result;
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
