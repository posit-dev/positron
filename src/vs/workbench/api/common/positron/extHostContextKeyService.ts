/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as extHostProtocol from './extHost.positron.protocol.js';

export class ExtHostContextKeyService implements extHostProtocol.ExtHostContextKeyServiceShape {

	private readonly _proxy: extHostProtocol.MainThreadContextKeyServiceShape;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
	) {
		// Trigger creation of the proxy
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadContextKeyService);
	}

	/**
	 * Queries the main thread with a `when` clause.
	 *
	 * @returns If the `when` clause evaluates to true or false.
	 */
	public evaluateWhenClause(whenClause: string): Promise<boolean> {
		return this._proxy.$evaluateWhenClause(whenClause);
	}

}

