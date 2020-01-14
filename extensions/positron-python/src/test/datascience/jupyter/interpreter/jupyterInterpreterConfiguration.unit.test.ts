// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { ApplicationShell } from '../../../../client/common/application/applicationShell';
import { IApplicationShell } from '../../../../client/common/application/types';
import { ProductInstaller } from '../../../../client/common/installer/productInstaller';
import { IInstaller, InstallerResponse, Product } from '../../../../client/common/types';
import { Common, DataScience } from '../../../../client/common/utils/localize';
import { Architecture } from '../../../../client/common/utils/platform';
import {
    JupyterInterpreterConfigurationResponse,
    JupyterInterpreterConfigurationService
} from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterConfiguration';
import { InterpreterType, PythonInterpreter } from '../../../../client/interpreter/contracts';

suite('Data Science - Jupyter Interpreter Configuration', () => {
    let configuration: JupyterInterpreterConfigurationService;
    let appShell: IApplicationShell;
    let installer: IInstaller;
    const pythonInterpreter: PythonInterpreter = {
        path: '',
        architecture: Architecture.Unknown,
        sysPrefix: '',
        sysVersion: '',
        type: InterpreterType.Unknown
    };
    setup(() => {
        appShell = mock(ApplicationShell);
        installer = mock(ProductInstaller);
        configuration = new JupyterInterpreterConfigurationService(instance(appShell), instance(installer));
    });
    teardown(() => {
        // This must be called.
        verify(installer.isInstalled(Product.jupyter, pythonInterpreter)).once();
        // This must be called.
        verify(installer.isInstalled(Product.notebook, pythonInterpreter)).once();
    });
    test('Return ok if all dependencies are installed', async () => {
        when(installer.isInstalled(Product.jupyter, pythonInterpreter)).thenResolve(true);
        when(installer.isInstalled(Product.notebook, pythonInterpreter)).thenResolve(true);

        const response = await configuration.configureInterpreter(pythonInterpreter);

        assert.equal(response, JupyterInterpreterConfigurationResponse.ok);
    });
    async function testPromptIfModuleNotInstalled(jupyterInstalled: boolean, notebookInstalled: boolean): Promise<void> {
        when(installer.isInstalled(Product.jupyter, pythonInterpreter)).thenResolve(jupyterInstalled);
        when(installer.isInstalled(Product.notebook, pythonInterpreter)).thenResolve(notebookInstalled);
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve();

        const response = await configuration.configureInterpreter(pythonInterpreter);

        verify(appShell.showErrorMessage(anything(), DataScience.jupyterInstall(), DataScience.selectDifferentJupyterInterpreter(), Common.cancel())).once();
        assert.equal(response, JupyterInterpreterConfigurationResponse.cancel);
    }
    test('Prompt to install if Jupyter is not installed', async () => testPromptIfModuleNotInstalled(false, true));
    test('Prompt to install if notebook is not installed', async () => testPromptIfModuleNotInstalled(true, false));
    test('Prompt to install if jupyter & notebook is not installed', async () => testPromptIfModuleNotInstalled(false, false));

    async function testInstallationOfJupyter(installerResponse: InstallerResponse, expectedConfigurationReponse: JupyterInterpreterConfigurationResponse): Promise<void> {
        when(installer.isInstalled(Product.jupyter, pythonInterpreter)).thenResolve(false);
        when(installer.isInstalled(Product.notebook, pythonInterpreter)).thenResolve(true);
        // tslint:disable-next-line: no-any
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(DataScience.jupyterInstall() as any);
        when(installer.install(anything(), anything())).thenResolve(installerResponse);

        const response = await configuration.configureInterpreter(pythonInterpreter);

        verify(installer.install(Product.jupyter, pythonInterpreter)).once();
        verify(installer.install(anything(), anything())).once();
        assert.equal(response, expectedConfigurationReponse);
    }
    async function testInstallationOfJupyterAndNotebook(
        jupyterInstallerResponse: InstallerResponse,
        notebookInstallationResponse: InstallerResponse,
        expectedConfigurationReponse: JupyterInterpreterConfigurationResponse
    ): Promise<void> {
        when(installer.isInstalled(Product.jupyter, pythonInterpreter)).thenResolve(false);
        when(installer.isInstalled(Product.notebook, pythonInterpreter)).thenResolve(false);
        // tslint:disable-next-line: no-any
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve(DataScience.jupyterInstall() as any);
        when(installer.install(Product.jupyter, anything())).thenResolve(jupyterInstallerResponse);
        when(installer.install(Product.notebook, anything())).thenResolve(notebookInstallationResponse);

        const response = await configuration.configureInterpreter(pythonInterpreter);

        verify(installer.install(Product.jupyter, pythonInterpreter)).once();
        verify(installer.install(Product.notebook, pythonInterpreter)).once();
        verify(installer.install(anything(), anything())).twice();
        assert.equal(response, expectedConfigurationReponse);
    }
    test('Install Jupyter and return ok if installed successfully', async () => testInstallationOfJupyter(InstallerResponse.Installed, JupyterInterpreterConfigurationResponse.ok));
    test('Install Jupyter & notebook and return ok if both are installed successfully', async () =>
        testInstallationOfJupyterAndNotebook(InstallerResponse.Installed, InstallerResponse.Installed, JupyterInterpreterConfigurationResponse.ok));
    test('Install Jupyter & notebook and return cancel if notebook is not installed', async () =>
        testInstallationOfJupyterAndNotebook(InstallerResponse.Installed, InstallerResponse.Ignore, JupyterInterpreterConfigurationResponse.cancel));
    test('Install Jupyter and return cancel if installation is disabled', async () =>
        testInstallationOfJupyter(InstallerResponse.Disabled, JupyterInterpreterConfigurationResponse.cancel));
    test('Install Jupyter and return cancel if installation is ignored', async () =>
        testInstallationOfJupyter(InstallerResponse.Ignore, JupyterInterpreterConfigurationResponse.cancel));
});
