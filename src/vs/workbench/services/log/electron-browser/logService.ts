/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConsoleLogger, ILogger, isDevConsoleLogForwardingEnabled, registerDevConsoleLogForwarder } from '../../../../platform/log/common/log.js';
import { INativeWorkbenchEnvironmentService } from '../../environment/electron-browser/environmentService.js';
import { LoggerChannelClient } from '../../../../platform/log/common/logIpc.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { windowLogGroup, windowLogId } from '../common/logConstants.js';
import { LogService } from '../../../../platform/log/common/logService.js';
// --- Start Positron ---
import { FixedLevelConsoleLogger, PINNED_CONSOLE_LEVEL, shouldPinConsoleEcho } from '../common/fixedLevelConsoleLogger.js';
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
			// Under the e2e smoke driver the console echo is pinned instead of following the
			// file-log level, which `--log=trace` would otherwise push over the Playwright CDP
			// session in volumes that starve it. See PINNED_CONSOLE_LEVEL for why Debug.
			// consoleLogger = new ConsoleLogger(fileLogger.getLevel());
			consoleLogger = shouldPinConsoleEcho(environmentService)
				? new FixedLevelConsoleLogger(PINNED_CONSOLE_LEVEL)
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
