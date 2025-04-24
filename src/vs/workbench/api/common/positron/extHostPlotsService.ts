/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as extHostProtocol from './extHost.positron.protocol.js';
import { Emitter } from '../../../../base/common/event.js';
import { PlotsRenderSettings } from './extHostTypes.positron.js';

export class ExtHostPlotsService implements extHostProtocol.ExtHostPlotsServiceShape {
	private readonly _proxy: extHostProtocol.MainThreadPlotsServiceShape;
	private readonly _onDidChangePlotsRenderSettings = new Emitter<PlotsRenderSettings>();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadPlotsService);
	}

	onDidChangePlotsRenderSettings = this._onDidChangePlotsRenderSettings.event;

	/**
	 * Queries the main thread for the current plot render settings.
	 */
	getPlotsRenderSettings(): Promise<PlotsRenderSettings> {
		return this._proxy.$getPlotsRenderSettings();
	}

	// --- from main thread

	$onDidChangePlotsRenderSettings(settings: PlotsRenderSettings): void {
		this._onDidChangePlotsRenderSettings.fire(settings);
	}
}
