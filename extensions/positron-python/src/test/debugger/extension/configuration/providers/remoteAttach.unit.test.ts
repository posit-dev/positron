// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { DebugConfigStrings } from '../../../../../client/common/utils/localize';
import { MultiStepInput } from '../../../../../client/common/utils/multiStepInput';
import { DebuggerTypeName } from '../../../../../client/debugger/constants';
import * as configuration from '../../../../../client/debugger/extension/configuration/utils/configuration';
import * as remoteAttach from '../../../../../client/debugger/extension/configuration/providers/remoteAttach';
import { DebugConfigurationState } from '../../../../../client/debugger/extension/types';

suite('Debugging - Configuration Provider Remote Attach', () => {
    let input: MultiStepInput<DebugConfigurationState>;

    setup(() => {
        input = mock<MultiStepInput<DebugConfigurationState>>(MultiStepInput);
    });
    teardown(() => {
        sinon.restore();
    });
    test('Configure port will display prompt', async () => {
        when(input.showInputBox(anything())).thenResolve();

        await configuration.configurePort(instance(input), {});

        verify(input.showInputBox(anything())).once();
    });
    test('Configure port will default to 5678 if entered value is not a number', async () => {
        const config: { connect?: { port?: number } } = {};
        when(input.showInputBox(anything())).thenResolve('xyz');

        await configuration.configurePort(instance(input), config);

        verify(input.showInputBox(anything())).once();
        expect(config).to.be.deep.equal({ connect: { port: 5678 } });
    });
    test('Configure port will default to 5678', async () => {
        const config: { connect?: { port?: number } } = {};
        when(input.showInputBox(anything())).thenResolve();

        await configuration.configurePort(instance(input), config);

        verify(input.showInputBox(anything())).once();
        expect(config).to.be.deep.equal({ connect: { port: 5678 } });
    });
    test('Configure port will use user selected value', async () => {
        const config: { connect?: { port?: number } } = {};
        when(input.showInputBox(anything())).thenResolve('1234');

        await configuration.configurePort(instance(input), config);

        verify(input.showInputBox(anything())).once();
        expect(config).to.be.deep.equal({ connect: { port: 1234 } });
    });
    test('Launch JSON with default host name', async () => {
        const folder = { uri: Uri.parse(path.join('one', 'two')), name: '1', index: 0 };
        const state = { config: {}, folder };
        let portConfigured = false;
        when(input.showInputBox(anything())).thenResolve();

        sinon.stub(configuration, 'configurePort').callsFake(async () => {
            portConfigured = true;
        });

        const configurePort = await remoteAttach.buildRemoteAttachConfiguration(instance(input), state);
        if (configurePort) {
            await configurePort!(input, state);
        }

        const config = {
            name: DebugConfigStrings.attach.snippet.name,
            type: DebuggerTypeName,
            request: 'attach',
            connect: {
                host: 'localhost',
                port: 5678,
            },
            pathMappings: [
                {
                    localRoot: '${workspaceFolder}',
                    remoteRoot: '.',
                },
            ],
            justMyCode: true,
        };

        expect(state.config).to.be.deep.equal(config);
        expect(portConfigured).to.be.equal(true, 'Port not configured');
    });
    test('Launch JSON with user defined host name', async () => {
        const folder = { uri: Uri.parse(path.join('one', 'two')), name: '1', index: 0 };
        const state = { config: {}, folder };
        let portConfigured = false;
        when(input.showInputBox(anything())).thenResolve('Hello');
        sinon.stub(configuration, 'configurePort').callsFake(async (_, cfg) => {
            portConfigured = true;
            cfg.connect!.port = 9999;
        });
        const configurePort = await remoteAttach.buildRemoteAttachConfiguration(instance(input), state);
        if (configurePort) {
            await configurePort(input, state);
        }

        const config = {
            name: DebugConfigStrings.attach.snippet.name,
            type: DebuggerTypeName,
            request: 'attach',
            connect: {
                host: 'Hello',
                port: 9999,
            },
            pathMappings: [
                {
                    localRoot: '${workspaceFolder}',
                    remoteRoot: '.',
                },
            ],
            justMyCode: true,
        };

        expect(state.config).to.be.deep.equal(config);
        expect(portConfigured).to.be.equal(true, 'Port not configured');
    });
});
