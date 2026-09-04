/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ConsoleLogger, LogLevel, MultiplexLogger } from '../../../../../platform/log/common/log.js';
import { FixedLevelConsoleLogger } from '../../common/fixedLevelConsoleLogger.js';

describe('FixedLevelConsoleLogger', () => {

	test('keeps the level it was constructed with when setLevel is called', () => {
		const logger = new FixedLevelConsoleLogger(LogLevel.Info);

		logger.setLevel(LogLevel.Trace);

		expect(logger.getLevel()).toBe(LogLevel.Info);
	});

	test('ignores the level a MultiplexLogger fans out, unlike ConsoleLogger', () => {
		// This is the coupling the class exists to break: LogService wires the file logger's
		// onDidChangeLogLevel to its own setLevel, which a MultiplexLogger forwards to every
		// logger it holds. Under `--log=trace` that puts trace records on the console, and the
		// e2e smoke driver pushes them over the Playwright CDP session.
		const pinned = new FixedLevelConsoleLogger(LogLevel.Info);
		const upstream = new ConsoleLogger(LogLevel.Info);

		new MultiplexLogger([pinned, upstream]).setLevel(LogLevel.Trace);

		expect({ pinned: pinned.getLevel(), upstream: upstream.getLevel() })
			.toEqual({ pinned: LogLevel.Info, upstream: LogLevel.Trace });
	});
});
