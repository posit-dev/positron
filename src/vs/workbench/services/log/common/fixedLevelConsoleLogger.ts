/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConsoleLogger, LogLevel } from '../../../../platform/log/common/log.js';

/**
 * A {@link ConsoleLogger} whose level is pinned at construction and cannot be changed
 * afterwards.
 *
 * `LogService` wires `primaryLogger.onDidChangeLogLevel` to its own `setLevel`, which a
 * `MultiplexLogger` then fans out to every logger it holds. That couples the console echo to
 * the file-log level, so `--log=trace` puts trace-level output on the console as well as on
 * disk. Under the e2e smoke driver that echo is pushed over the Playwright CDP session, and
 * the volume starves the request/response direction of the same session: `expect` evaluations
 * and screencast frames queue up for tens of seconds and then drain in one batch, while the
 * renderer itself is running normally. Pinning the console echo keeps the CDP channel quiet
 * without touching what is written to disk.
 */
export class FixedLevelConsoleLogger extends ConsoleLogger {

	private levelPinned = false;

	constructor(logLevel: LogLevel) {
		super(logLevel);
		// Field initializers run after `super()`, so `levelPinned` is still undefined during the
		// base constructor's own `setLevel` call and the requested level is applied normally.
		this.levelPinned = true;
	}

	override setLevel(level: LogLevel): void {
		if (this.levelPinned) {
			return;
		}
		super.setLevel(level);
	}
}
