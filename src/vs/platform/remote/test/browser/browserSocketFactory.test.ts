/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BrowserSocketFactory, IWebSocket, IWebSocketCloseEvent } from '../../browser/browserSocketFactory.js';
import { WebSocketRemoteConnection } from '../../common/remoteAuthorityResolver.js';

class FakeWebSocket implements IWebSocket {
	private readonly _onData = new Emitter<ArrayBuffer>();
	private readonly _onOpen = new Emitter<void>();
	private readonly _onClose = new Emitter<IWebSocketCloseEvent | void>();
	private readonly _onError = new Emitter<unknown>();
	readonly onData = this._onData.event;
	readonly onOpen = this._onOpen.event;
	readonly onClose = this._onClose.event;
	readonly onError = this._onError.event;
	closeCount = 0;

	fireOpen(): void { this._onOpen.fire(); }
	send(): void { }
	close(): void { this.closeCount++; }
	dispose(): void {
		this._onData.dispose();
		this._onOpen.dispose();
		this._onClose.dispose();
		this._onError.dispose();
	}
}

suite('PWB BrowserSocketFactory cancellation', () => {
	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	function connect() {
		const ws = ds.add(new FakeWebSocket());
		const cts = ds.add(new CancellationTokenSource());
		const factory = new BrowserSocketFactory({ create: () => ws });
		const connecting = factory.connect(new WebSocketRemoteConnection('localhost', 8787), '/', 'reconnection=true', 'test', cts.token);
		return { ws, cts, connecting };
	}

	test('closes a still-connecting WebSocket when cancelled', async () => {
		const { ws, cts, connecting } = connect();
		cts.cancel();
		await assert.rejects(connecting, (err: unknown) => isCancellationError(err));
		assert.strictEqual(ws.closeCount, 1);
	});

	test('leaves an opened WebSocket alone when cancelled afterwards', async () => {
		const { ws, cts, connecting } = connect();
		ws.fireOpen();
		ds.add(await connecting);
		cts.cancel();
		assert.strictEqual(ws.closeCount, 0);
	});
});
