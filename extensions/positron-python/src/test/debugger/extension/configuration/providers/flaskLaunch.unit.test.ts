// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { DebugConfigStrings } from '../../../../../client/common/utils/localize';
import { MultiStepInput } from '../../../../../client/common/utils/multiStepInput';
import { DebuggerTypeName } from '../../../../../client/debugger/constants';
import { DebugConfigurationState } from '../../../../../client/debugger/extension/types';
import * as flaskLaunch from '../../../../../client/debugger/extension/configuration/providers/flaskLaunch';

suite('Debugging - Configuration Provider Flask', () => {
    let pathExistsStub: sinon.SinonStub;
    let input: MultiStepInput<DebugConfigurationState>;
    setup(() => {
        input = mock<MultiStepInput<DebugConfigurationState>>(MultiStepInput);
        pathExistsStub = sinon.stub(fs, 'pathExists');
    });
    teardown(() => {
        sinon.restore();
    });
    test("getApplicationPath should return undefined if file doesn't exist", async () => {
        const folder = { uri: Uri.parse(path.join('one', 'two')), name: '1', index: 0 };
        const appPyPath = path.join(folder.uri.fsPath, 'app.py');
        pathExistsStub.withArgs(appPyPath).resolves(false);
        const file = await flaskLaunch.getApplicationPath(folder);

        expect(file).to.be.equal(undefined, 'Should return undefined');
    });
    test('getApplicationPath should file path', async () => {
        const folder = { uri: Uri.parse(path.join('one', 'two')), name: '1', index: 0 };
        const appPyPath = path.join(folder.uri.fsPath, 'app.py');
        pathExistsStub.withArgs(appPyPath).resolves(true);
        const file = await flaskLaunch.getApplicationPath(folder);

        expect(file).to.be.equal('app.py');
    });
    test('Launch JSON with valid python path', async () => {
        const folder = { uri: Uri.parse(path.join('one', 'two')), name: '1', index: 0 };
        const state = { config: {}, folder };

        await flaskLaunch.buildFlaskLaunchDebugConfiguration(instance(input), state);

        const config = {
            name: DebugConfigStrings.flask.snippet.name,
            type: DebuggerTypeName,
            request: 'launch',
            module: 'flask',
            env: {
                FLASK_APP: 'app.py',
                FLASK_DEBUG: '1',
            },
            args: ['run', '--no-debugger', '--no-reload'],
            jinja: true,
            justMyCode: true,
        };

        expect(state.config).to.be.deep.equal(config);
    });
    test('Launch JSON with selected app path', async () => {
        const folder = { uri: Uri.parse(path.join('one', 'two')), name: '1', index: 0 };
        const state = { config: {}, folder };

        when(input.showInputBox(anything())).thenResolve('hello');

        await flaskLaunch.buildFlaskLaunchDebugConfiguration(instance(input), state);

        const config = {
            name: DebugConfigStrings.flask.snippet.name,
            type: DebuggerTypeName,
            request: 'launch',
            module: 'flask',
            env: {
                FLASK_APP: 'hello',
                FLASK_DEBUG: '1',
            },
            args: ['run', '--no-debugger', '--no-reload'],
            jinja: true,
            justMyCode: true,
        };

        expect(state.config).to.be.deep.equal(config);
    });
    test('Launch JSON with default managepy path', async () => {
        const folder = { uri: Uri.parse(path.join('one', 'two')), name: '1', index: 0 };
        const state = { config: {}, folder };
        when(input.showInputBox(anything())).thenResolve();

        await flaskLaunch.buildFlaskLaunchDebugConfiguration(instance(input), state);

        const config = {
            name: DebugConfigStrings.flask.snippet.name,
            type: DebuggerTypeName,
            request: 'launch',
            module: 'flask',
            env: {
                FLASK_APP: 'app.py',
                FLASK_DEBUG: '1',
            },
            args: ['run', '--no-debugger', '--no-reload'],
            jinja: true,
            justMyCode: true,
        };

        expect(state.config).to.be.deep.equal(config);
    });
});
