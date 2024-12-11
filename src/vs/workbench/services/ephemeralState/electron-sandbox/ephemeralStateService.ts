/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { EPHEMERAL_STATE_CHANNEL_NAME, EphemeralStateChannelClient } from '../../../../platform/ephemeralState/common/ephemeralStateIpc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';

/**
 * The implementation of the `IEphemeralStateService` for the Electron sandbox.
 * This is used in desktop environments; see `BrowserEphemeralStateService` for
 * web-based environments.
 *
 * The main difference between these two implementations is that the Electron
 * sandbox implementation uses IPC to communicate with the main process, while
 * the browser implementation uses the remote agent service.
 */
export class ElectronEphemeralStateService implements IEphemeralStateService {

	_serviceBrand: undefined;
	_channel: EphemeralStateChannelClient;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this._channel = instantiationService.createInstance(EphemeralStateChannelClient, mainProcessService.getChannel(EPHEMERAL_STATE_CHANNEL_NAME));
	}

	getItem<T>(key: unknown, defaultValue?: unknown): Promise<T | undefined> {
		return this._channel.getItem(key, defaultValue);
	}

	setItem(key: string, data?: object | string | number | boolean | undefined | null): Promise<void> {
		return this._channel.setItem(key, data);
	}

	removeItem(key: string): Promise<void> {
		return this._channel.removeItem(key);
	}
}

registerSingleton(IEphemeralStateService, ElectronEphemeralStateService, InstantiationType.Delayed);

