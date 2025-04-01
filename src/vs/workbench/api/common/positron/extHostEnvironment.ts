/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { EnvironmentVariableAction } from 'positron';
import * as extHostProtocol from './extHost.positron.protocol.js';

export class ExtHostEnvironment implements extHostProtocol.ExtHostEnvironmentShape {

	private readonly _proxy: extHostProtocol.MainThreadEnvironmentShape;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadEnvironment);
	}

	public async getEnvironmentContributions(): Promise<Record<string, EnvironmentVariableAction[]>> {
		const contributions = await this._proxy.$getEnvironmentContributions();
		return contributions;
	}
}
