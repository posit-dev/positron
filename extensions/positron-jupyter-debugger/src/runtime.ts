/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { DebugProtocol } from '@vscode/debugprotocol';
import { DisposableStore, disposableTimeout, formatDebugMessage } from './util.js';

/**
 * Send a debug request to the runtime and wait for the response.
 *
 * @param request The debug request to send.
 * @param disposables Disposable store to manage response listeners.
 * @returns A promise that resolves with the response from the runtime, or rejects after a timeout.
 */
export async function performRuntimeDebugRPC<Req extends DebugProtocol.Request, Res extends DebugProtocol.Response>(
	request: Req,
	runtimeSession: positron.LanguageRuntimeSession,
	disposables: DisposableStore,
): Promise<Res> {
	// Generate a unique ID for the request.
	const id = randomUUID();

	// Create a promise that resolves with the response from the runtime.
	const responsePromise = new Promise<Res>((resolve, reject) => {
		const responseDisposables = disposables.add(new DisposableStore());

		// Listen for the response from the runtime.
		responseDisposables.add(runtimeSession.onDidReceiveRuntimeMessage((message) => {
			if (message.parent_id !== id) {
				return;
			}
			if (message.type === positron.LanguageRuntimeMessageType.DebugReply) {
				const debugReply = message as positron.LanguageRuntimeDebugReply;
				if (debugReply.content === undefined) {
					reject(new Error('No content in debug reply. Is debugpy already listening?'));
				}
				responseDisposables.dispose();
				resolve(debugReply.content as Res);
			}
		}));

		// Timeout if no response is received within 5 seconds.
		responseDisposables.add(disposableTimeout(() => {
			responseDisposables.dispose();
			reject(new Error(`Timeout waiting for response to request: ${formatDebugMessage(request)}`));
		}, 5000));

		// Send the request to the runtime.
		try {
			runtimeSession.debug(request, id);
		} catch (error) {
			responseDisposables.dispose();
			reject(new Error(`Error sending request to runtime: ${formatDebugMessage(request)}. Reason: ${JSON.stringify(error)}`));
		}
	});

	// Wait for the response.
	const response = await responsePromise;

	return response;
}
