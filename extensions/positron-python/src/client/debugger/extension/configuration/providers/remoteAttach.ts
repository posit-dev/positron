// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { DebugConfigStrings } from '../../../../common/utils/localize';
import { InputStep, MultiStepInput } from '../../../../common/utils/multiStepInput';
import { sendTelemetryEvent } from '../../../../telemetry';
import { EventName } from '../../../../telemetry/constants';
import { DebuggerTypeName } from '../../../constants';
import { AttachRequestArguments } from '../../../types';
import { DebugConfigurationState, DebugConfigurationType } from '../../types';
import { configurePort } from '../utils/configuration';

const defaultHost = 'localhost';
const defaultPort = 5678;

export async function buildRemoteAttachConfiguration(
    input: MultiStepInput<DebugConfigurationState>,
    state: DebugConfigurationState,
): Promise<InputStep<DebugConfigurationState> | void> {
    const config: Partial<AttachRequestArguments> = {
        name: DebugConfigStrings.attach.snippet.name,
        type: DebuggerTypeName,
        request: 'attach',
        connect: {
            host: defaultHost,
            port: defaultPort,
        },
        pathMappings: [
            {
                localRoot: '${workspaceFolder}',
                remoteRoot: '.',
            },
        ],
        justMyCode: true,
    };

    const connect = config.connect!;
    connect.host = await input.showInputBox({
        title: DebugConfigStrings.attach.enterRemoteHost.title,
        step: 1,
        totalSteps: 2,
        value: connect.host || defaultHost,
        prompt: DebugConfigStrings.attach.enterRemoteHost.prompt,
        validate: (value) =>
            Promise.resolve(
                value && value.trim().length > 0 ? undefined : DebugConfigStrings.attach.enterRemoteHost.invalid,
            ),
    });
    if (!connect.host) {
        connect.host = defaultHost;
    }

    sendTelemetryEvent(EventName.DEBUGGER_CONFIGURATION_PROMPTS, undefined, {
        configurationType: DebugConfigurationType.remoteAttach,
        manuallyEnteredAValue: connect.host !== defaultHost,
    });
    Object.assign(state.config, config);
    return (_) => configurePort(input, state.config);
}
