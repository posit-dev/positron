/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { KallichoreApiInstance, KallichoreTransport } from '../KallichoreApiInstance';
import { KallichoreServerState } from '../ServerState';

function makeState(overrides: Partial<KallichoreServerState>): KallichoreServerState {
	return {
		server_path: '/usr/lib/bin/kcserver',
		server_pid: 4242,
		bearer_token: 'token',
		log_path: '/tmp/kallichore.log',
		...overrides,
	};
}

suite('KallichoreApiInstance basePath', () => {
	test('exposes the base path it was configured with', () => {
		const api = new KallichoreApiInstance(KallichoreTransport.TCP);
		api.loadState(makeState({ base_path: 'http://127.0.0.1:49977', transport: KallichoreTransport.TCP }));
		assert.strictEqual(api.basePath, 'http://127.0.0.1:49977');
	});

	test('TCP base path survives a state round-trip', () => {
		// Regression: server start finalizes the state with `base_path:
		// this._api.basePath` and reloads it into the live API via
		// refreshServerState. If `basePath` returned undefined, the reload would
		// repoint the API at the DefaultApi default (localhost:80) and every
		// subsequent request would fail with ECONNREFUSED, so no session could
		// start. The base path must come back unchanged.
		const api = new KallichoreApiInstance(KallichoreTransport.TCP);
		api.loadState(makeState({ base_path: 'http://127.0.0.1:49977', transport: KallichoreTransport.TCP }));

		// Rebuild the state from the live API's base path, exactly as
		// setServerStarted does, and reload it.
		const rebuilt = makeState({ base_path: api.basePath, transport: KallichoreTransport.TCP });
		api.loadState(rebuilt);

		assert.strictEqual(api.basePath, 'http://127.0.0.1:49977');
	});

	test('domain socket connections have no base path', () => {
		// Domain sockets route via the socket path rather than a host, so the
		// connection state carries no base_path. The round-trip must keep it
		// absent (rather than coercing it to a value that would repoint the API).
		const api = new KallichoreApiInstance(KallichoreTransport.UnixSocket);
		api.loadState(makeState({ socket_path: '/tmp/kallichore.sock', transport: KallichoreTransport.UnixSocket }));
		assert.strictEqual(api.basePath, undefined);

		const rebuilt = makeState({ base_path: api.basePath, socket_path: '/tmp/kallichore.sock', transport: KallichoreTransport.UnixSocket });
		api.loadState(rebuilt);
		assert.strictEqual(api.basePath, undefined);
	});
});
