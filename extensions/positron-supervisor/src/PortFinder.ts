/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';

/**
 * Finds an available TCP port
 *
 * @param excluding A list of ports to exclude from the search
 * @param maxTries The maximum number of attempts
 * @returns An available TCP port
 */
export async function findAvailablePort(excluding: Array<number>, maxTries: number): Promise<number> {
	const portmin = 41952;
	const portmax = 65536;
	const nextPort = findAvailablePort;

	return new Promise((resolve, reject) => {
		// Pick a random port not on the exclusion list
		let candidate = 0;
		do {
			candidate = Math.floor(Math.random() * (portmax - portmin) + portmin);
		} while (excluding.includes(candidate));

		const test = net.createServer();

		// If we can't bind to the port, pick another random port
		test.once('error', function (err) {
			// ... unless we've already tried too many times; likely there's
			// a networking issue
			if (maxTries < 1) {
				reject(err);
			}

			//  Try again
			resolve(nextPort(excluding, maxTries - 1));
		});

		// If we CAN bind to the port, shutdown the server and return the
		// port when it's available
		test.once('listening', function () {
			test.once('close', function () {
				// Add the port to the exclusion list so we don't try to bind to
				// it again
				excluding.push(candidate);
				resolve(candidate);
			});
			test.close();
		});

		// Begin attempting to listen on the candidate port. Use 'localhost' by
		// name; otherwise the server attempts to listen on 0.0.0.0, which may
		// be restricted by the OS.
		test.listen(candidate, 'localhost');
	});
}
