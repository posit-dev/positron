/* eslint-disable @typescript-eslint/no-explicit-any */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { DebugConfigStrings } from '../../../../common/utils/localize';
import { MultiStepInput } from '../../../../common/utils/multiStepInput';
import { sendTelemetryEvent } from '../../../../telemetry';
import { EventName } from '../../../../telemetry/constants';
import { AttachRequestArguments } from '../../../types';
import { DebugConfigurationState, DebugConfigurationType } from '../../types';

const defaultPort = 5678;

export async function configurePort(
    input: MultiStepInput<DebugConfigurationState>,
    config: Partial<AttachRequestArguments>,
): Promise<void> {
    const connect = config.connect || (config.connect = {});
    const port = await input.showInputBox({
        title: DebugConfigStrings.attach.enterRemotePort.title,
        step: 2,
        totalSteps: 2,
        value: (connect.port || defaultPort).toString(),
        prompt: DebugConfigStrings.attach.enterRemotePort.prompt,
        validate: (value) =>
            Promise.resolve(
                value && /^\d+$/.test(value.trim()) ? undefined : DebugConfigStrings.attach.enterRemotePort.invalid,
            ),
    });
    if (port && /^\d+$/.test(port.trim())) {
        connect.port = parseInt(port, 10);
    }
    if (!connect.port) {
        connect.port = defaultPort;
    }
    sendTelemetryEvent(EventName.DEBUGGER_CONFIGURATION_PROMPTS, undefined, {
        configurationType: DebugConfigurationType.remoteAttach,
        manuallyEnteredAValue: connect.port !== defaultPort,
    });
}
