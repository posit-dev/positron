/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { ILogService, ILogger, ILoggerService, LogLevel } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { ITelemetryAppender, TelemetryLogGroup, isLoggingOnly, supportsTelemetry, telemetryLogId, validateTelemetryData } from './telemetryUtils.js';

export class TelemetryLogAppender extends Disposable implements ITelemetryAppender {

	private readonly logger: ILogger;

	constructor(
		@ILogService logService: ILogService,
		@ILoggerService loggerService: ILoggerService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IProductService productService: IProductService,
		private readonly prefix: string = '',
	) {
		super();

		const logger = loggerService.getLogger(telemetryLogId);
		if (logger) {
			this.logger = this._register(logger);
		} else {
			// Not a perfect check, but a nice way to indicate if we only have logging enabled for debug purposes and nothing is actually being sent
			const justLoggingAndNotSending = isLoggingOnly(productService, environmentService);
			const logSuffix = justLoggingAndNotSending ? ' (Not Sent)' : '';
			const isVisible = () => supportsTelemetry(productService, environmentService) && logService.getLevel() === LogLevel.Trace;
			this.logger = this._register(loggerService.createLogger(telemetryLogId,
				{
					name: localize('telemetryLog', "Telemetry{0}", logSuffix),
					hidden: !isVisible(),
					group: TelemetryLogGroup
				}));
			this._register(logService.onDidChangeLogLevel(() => loggerService.setVisibility(telemetryLogId, isVisible())));
		}
	}

	flush(): Promise<void> {
		return Promise.resolve();
	}

	log(eventName: string, data: any): void {
		this.logger.trace(`${this.prefix}telemetry/${eventName}`, validateTelemetryData(data));
	}
}

