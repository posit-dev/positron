/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConsoleLogger, ILogger, isDevConsoleLogForwardingEnabled, LogLevel, registerDevConsoleLogForwarder } from '../../../../platform/log/common/log.js';
import { INativeWorkbenchEnvironmentService } from '../../environment/electron-browser/environmentService.js';
import { LoggerChannelClient } from '../../../../platform/log/common/logIpc.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { windowLogGroup, windowLogId } from '../common/logConstants.js';
import { LogService } from '../../../../platform/log/common/logService.js';
// --- Start Positron ---
import { FixedLevelConsoleLogger } from '../common/fixedLevelConsoleLogger.js';
// --- End Positron ---

export class NativeLogService extends LogService {

	constructor(loggerService: LoggerChannelClient, environmentService: INativeWorkbenchEnvironmentService) {

		const disposables = new DisposableStore();

		const fileLogger = disposables.add(loggerService.createLogger(environmentService.logFile, { id: windowLogId, name: windowLogGroup.name, group: windowLogGroup }));

		let consoleLogger: ILogger;
		if (environmentService.isExtensionDevelopment && !!environmentService.extensionTestsLocationURI) {
			// Extension development test CLI: forward everything to main side
			consoleLogger = loggerService.createConsoleMainLogger();
		} else {
			// Normal mode: Log to console
			// --- Start Positron ---
			// The console echo below follows the file-log level, and e2e runs pass `--log=trace`,
			// so every trace record is also pushed over the Playwright CDP session. That flood
			// starves the session's request/response direction: `expect` evaluations park for tens
			// of seconds against a workbench that is already rendered, then drain in one batch.
			// Pin the echo at Info under the smoke driver; on-disk logs stay at trace, and
			// `--verbose` opts back out.
			// consoleLogger = new ConsoleLogger(fileLogger.getLevel());
			consoleLogger = environmentService.enableSmokeTestDriver && !environmentService.verbose
				? new FixedLevelConsoleLogger(LogLevel.Info)
				: new ConsoleLogger(fileLogger.getLevel());
			// --- End Positron ---
		}

		super(fileLogger, [consoleLogger]);

		if (!environmentService.isBuilt && isDevConsoleLogForwardingEnabled) {
			this._register(registerDevConsoleLogForwarder(this));
		}

		this._register(disposables);
	}
}
