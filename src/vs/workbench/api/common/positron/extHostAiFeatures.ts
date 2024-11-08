/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import * as extHostProtocol from './extHost.positron.protocol';

export class ExtHostAiFeatures implements extHostProtocol.ExtHostAiFeaturesShape {
	constructor(
		mainContext: extHostProtocol.IMainPositronContext
	) {
		// TODO: Trigger creation of proxy to main thread
	}

	registerAssistantProvider(assistant: any): IDisposable {
		throw new Error('Method not implemented.');
	}
}
