/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExtHostLifecycleShape, ShutdownReason } from './extHost.positron.protocol.js';
import { ShutdownReason as ApiShutdownReason } from './extHostTypes.positron.js';

export class ExtHostLifecycle extends Disposable implements ExtHostLifecycleShape {

	private readonly _onWillShutdown = this._register(new Emitter<positron.ShutdownReason>());
	readonly onWillShutdown: Event<positron.ShutdownReason> = this._onWillShutdown.event;

	async $onWillShutdown(reason: ShutdownReason): Promise<void> {
		this._onWillShutdown.fire(toApiShutdownReason(reason));
	}
}

function toApiShutdownReason(reason: ShutdownReason): ApiShutdownReason {
	switch (reason) {
		case ShutdownReason.Close: return ApiShutdownReason.Close;
		case ShutdownReason.Quit: return ApiShutdownReason.Quit;
		case ShutdownReason.Reload: return ApiShutdownReason.Reload;
		case ShutdownReason.Load: return ApiShutdownReason.Load;
	}
}
