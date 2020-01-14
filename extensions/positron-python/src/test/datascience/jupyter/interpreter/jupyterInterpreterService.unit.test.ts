// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Memento } from 'vscode';
import { Architecture } from '../../../../client/common/utils/platform';
import {
    JupyterInterpreterConfigurationResponse,
    JupyterInterpreterConfigurationService
} from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterConfiguration';
import { JupyterInterpreterSelector } from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterSelector';
import { JupyterInterpreterService } from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterService';
import { JupyterInterpreterStateStore } from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterStateStore';
import { IInterpreterService, InterpreterType, PythonInterpreter } from '../../../../client/interpreter/contracts';
import { InterpreterService } from '../../../../client/interpreter/interpreterService';
import { MockMemento } from '../../../mocks/mementos';

suite('Data Science - Jupyter Interpreter Service', () => {
    let jupyterInterpreterService: JupyterInterpreterService;
    let interpreterSelector: JupyterInterpreterSelector;
    let interpreterConfiguration: JupyterInterpreterConfigurationService;
    let interpreterService: IInterpreterService;
    let selectedInterpreterEventArgs: PythonInterpreter | undefined;
    let memento: Memento;
    let interpreterSelectionState: JupyterInterpreterStateStore;
    const pythonInterpreter: PythonInterpreter = {
        path: 'some path',
        architecture: Architecture.Unknown,
        sysPrefix: '',
        sysVersion: '',
        type: InterpreterType.Unknown
    };
    const secondPythonInterpreter: PythonInterpreter = {
        path: 'second interpreter path',
        architecture: Architecture.Unknown,
        sysPrefix: '',
        sysVersion: '',
        type: InterpreterType.Unknown
    };

    setup(() => {
        interpreterSelector = mock(JupyterInterpreterSelector);
        interpreterConfiguration = mock(JupyterInterpreterConfigurationService);
        interpreterService = mock(InterpreterService);
        memento = mock(MockMemento);
        interpreterSelectionState = mock(JupyterInterpreterStateStore);
        jupyterInterpreterService = new JupyterInterpreterService(
            instance(interpreterSelectionState),
            instance(interpreterSelector),
            instance(interpreterConfiguration),
            instance(interpreterService)
        );
        when(interpreterService.getInterpreterDetails(pythonInterpreter.path, undefined)).thenResolve(pythonInterpreter);
        when(interpreterService.getInterpreterDetails(secondPythonInterpreter.path, undefined)).thenResolve(secondPythonInterpreter);
        when(memento.update(anything(), anything())).thenResolve();
        jupyterInterpreterService.onDidChangeInterpreter(e => (selectedInterpreterEventArgs = e));
        when(interpreterSelector.selectInterpreter()).thenResolve(pythonInterpreter);
    });

    test('Cancelling interpreter configuration is same as cancelling selection of an interpreter', async () => {
        when(interpreterConfiguration.configureInterpreter(pythonInterpreter)).thenResolve(JupyterInterpreterConfigurationResponse.cancel);

        const response = await jupyterInterpreterService.selectInterpreter();

        verify(interpreterConfiguration.configureInterpreter(pythonInterpreter)).once();
        assert.equal(response, undefined);
        assert.isUndefined(selectedInterpreterEventArgs);
    });
    test('Once selected interpreter must be stored in settings and event fired', async () => {
        when(interpreterConfiguration.configureInterpreter(pythonInterpreter)).thenResolve(JupyterInterpreterConfigurationResponse.ok);

        const response = await jupyterInterpreterService.selectInterpreter();

        verify(interpreterConfiguration.configureInterpreter(pythonInterpreter)).once();
        assert.equal(response, pythonInterpreter);
        assert.equal(selectedInterpreterEventArgs, pythonInterpreter);

        // Selected interpreter should be returned.
        const selectedInterrpeter = await jupyterInterpreterService.selectInterpreter();

        assert.equal(selectedInterrpeter, pythonInterpreter);
    });
    test('Select another interpreter if user opts to not install dependencies', async () => {
        when(interpreterConfiguration.configureInterpreter(pythonInterpreter)).thenResolve(JupyterInterpreterConfigurationResponse.selectAnotherInterpreter);
        when(interpreterConfiguration.configureInterpreter(secondPythonInterpreter)).thenResolve(JupyterInterpreterConfigurationResponse.ok);
        let interpreterSelection = 0;
        when(interpreterSelector.selectInterpreter()).thenCall(() => {
            // When selecting intererpter for first time, return first interpreter
            // When selected interpretre
            interpreterSelection += 1;
            return interpreterSelection === 1 ? pythonInterpreter : secondPythonInterpreter;
        });

        const response = await jupyterInterpreterService.selectInterpreter();

        verify(interpreterSelector.selectInterpreter()).twice();
        verify(interpreterConfiguration.configureInterpreter(pythonInterpreter)).once();
        verify(interpreterConfiguration.configureInterpreter(secondPythonInterpreter)).once();
        assert.equal(response, secondPythonInterpreter);
        assert.equal(selectedInterpreterEventArgs, secondPythonInterpreter);

        // Selected interpreter should be the second interpreter.
        const selectedInterrpeter = await jupyterInterpreterService.selectInterpreter();

        assert.equal(selectedInterrpeter, secondPythonInterpreter);
    });
});
