/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as http from 'http';
import type * as net from 'net';
import { createUnlicensedServer } from '../../node/positronUnlicensedServer.js';
import { stubInterface } from '../../../test/vitest/stubInterface.js';

describe('createUnlicensedServer', () => {
	it('answers any request with the license page', async () => {
		const writeHead = vi.fn();
		const end = vi.fn();
		const res = stubInterface<http.ServerResponse>({ writeHead, end });

		// The workbench route, a static asset, and a path we never serve: the
		// server has no routing, so every one of them gets the page.
		for (const url of ['/', '/static/out/vs/workbench/workbench.web.main.js', '/nope']) {
			await createUnlicensedServer().handleRequest(
				stubInterface<http.IncomingMessage>({ url, method: 'GET' }),
				res
			);
		}

		expect(writeHead.mock.calls).toMatchInlineSnapshot(`
			[
			  [
			    200,
			    {
			      "Cache-Control": "no-store",
			      "Content-Type": "text/html; charset=utf-8",
			    },
			  ],
			  [
			    200,
			    {
			      "Cache-Control": "no-store",
			      "Content-Type": "text/html; charset=utf-8",
			    },
			  ],
			  [
			    200,
			    {
			      "Cache-Control": "no-store",
			      "Content-Type": "text/html; charset=utf-8",
			    },
			  ],
			]
		`);
		expect(end).toHaveBeenCalledWith(expect.stringContaining('mailto:sales@posit.co'));
	});

	it('closes web socket upgrades instead of leaving the client hanging', () => {
		const destroy = vi.fn();
		const socket = stubInterface<net.Socket>({ destroy });

		createUnlicensedServer().handleUpgrade(
			stubInterface<http.IncomingMessage>({ url: '/' }),
			socket,
			undefined
		);

		expect(destroy).toHaveBeenCalled();
	});

	it('reports itself as unlicensed so the kernel supervisor is held back', () => {
		expect(createUnlicensedServer().unlicensed).toBe(true);
	});
});
