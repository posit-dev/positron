/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Disposable } from 'vs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IPositronTerminalAppService } from 'vs/workbench/services/positronTerminalApp/common/positronTerminalAppService';

export class PositronTerminalAppService extends Disposable implements IPositronTerminalAppService {
	/** Needed for service branding in dependency injector. */
	_serviceBrand: undefined;

	/** Placeholder for service initialization. */
	initialize() {
		console.log('PositronTerminalAppService initialized.');
	}

	constructor() {
		super();
	}
}

// Register service.
registerSingleton(IPositronTerminalAppService, PositronTerminalAppService, InstantiationType.Delayed);
