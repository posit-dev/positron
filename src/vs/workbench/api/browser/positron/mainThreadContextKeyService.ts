/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { MainPositronContext, MainThreadContextKeyServiceShape } from '../../common/positron/extHost.positron.protocol.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

@extHostNamedCustomer(MainPositronContext.MainThreadContextKeyService)
export class MainThreadContextKeyService implements MainThreadContextKeyServiceShape {

	private readonly _disposables = new DisposableStore();

	constructor(
		extHostContext: IExtHostContext,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
	}

	$evaluateWhenClause(whenClause: string): Promise<boolean> {
		const precondition = ContextKeyExpr.deserialize(whenClause);
		if (precondition === undefined) {
			throw new Error(`Cannot evaluate when clause '${whenClause}'`);
		}
		return Promise.resolve(this.contextKeyService.contextMatchesRules(precondition));
	}

	public dispose(): void {
		this._disposables.dispose();
	}

}
