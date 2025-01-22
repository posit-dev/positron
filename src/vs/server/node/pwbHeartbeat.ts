/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { createDecorator } from '../../../vs/platform/instantiation/common/instantiation.js';
import { registerSingleton } from '../../../vs/platform/instantiation/common/extensions.js';
import { SyncDescriptor } from '../../../vs/platform/instantiation/common/descriptors.js';
import * as constants from './pwbConstants.js';

export const IPwbHeartbeatService = createDecorator<IPwbHeartbeatService>('pwbHeartbeatService');

export interface IPwbHeartbeatService {
	/**
	 * Sends a startup heartbeat event.
	 */
	sendInitialHeartbeat(): void;
}

export class PwbHeartbeatService implements IPwbHeartbeatService {
	private sessionId: string;
	private url: string;
	private product: string;
	private timeoutInMinutes: number;

	constructor() {
		const match = constants.kSessionUrl.match(/\/s\/([a-f0-9]+)\//);
		this.sessionId = match ? match[1] : '';

		const serverUrl = (constants.kServerUrl || (constants.kUriScheme + ':')) + constants.kBaseUrl;
		this.url = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) + constants.kHeartbeatEndpoint : serverUrl + constants.kHeartbeatEndpoint;

		this.product = constants.kPositron ? 'positron' : 'vscode';
		const timeoutSetting = constants.kPositron ? constants.kPositronTimeout : constants.kVsCodeTimeout;
		this.timeoutInMinutes = parseFloat(timeoutSetting) * 60;

		if (isNaN(this.timeoutInMinutes)) {
			this.timeoutInMinutes = 0;
		}
	}

	sendInitialHeartbeat(): void {
		const rpcCookie = process.env.RS_SESSION_RPC_COOKIE ?? '';

		if (rpcCookie === '') {
			console.log('No RPC Cookie found. Initial heartbeat request will fail.');
		}
		fetch(this.url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-RS-Session-Server-RPC-Cookie': rpcCookie,
			},
			body: JSON.stringify(
				{
					method: "heartbeat",
					kwparams: {
						sessionId: this.sessionId,
						username: constants.kUser,
						product: this.product
					}
				})
		})
			.then(response => {
				if (!response.ok) {
					return response.text().then(errorText => {
						throw new Error(`${response.status} ${response.statusText} - ${errorText}`);
					});
				}
				return response;
			})
			.then(() => {
				console.log(`Initial heartbeat for ${constants.kUser}'s session ${this.sessionId} successfully sent to ${this.url}`);
			})
			.catch(error => {
				console.log(`Initial heartbeat for ${constants.kUser}'s session ${this.sessionId} to ${this.url} failed: ` + error);
			});
	}
}

registerSingleton(IPwbHeartbeatService, new SyncDescriptor(PwbHeartbeatService));
