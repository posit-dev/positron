/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { ICommandNameArgumentTypeMapping } from '../../../common/application/commands';
import { ICommandManager } from '../../../common/application/types';
import { IServiceContainer } from '../../../ioc/types';
import { sendTelemetryEvent } from '../../../telemetry';
import { EventName } from '../../../telemetry/constants';
import { IDiagnostic } from '../types';
import { BaseDiagnosticCommand } from './base';

export class ExecuteVSCCommandWithArgs extends BaseDiagnosticCommand {
    constructor(
        diagnostic: IDiagnostic,
        private serviceContainer: IServiceContainer,
        private commandName: keyof ICommandNameArgumentTypeMapping,
        private commandArgs: any[],
    ) {
        super(diagnostic);
    }
    public async invoke(): Promise<void> {
        sendTelemetryEvent(EventName.DIAGNOSTICS_ACTION, undefined, { commandName: this.commandName });
        const cmdManager = this.serviceContainer.get<ICommandManager>(ICommandManager);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return cmdManager.executeCommand(this.commandName, ...(this.commandArgs as any)).then(() => undefined);
    }
}
