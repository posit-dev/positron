// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';
import { IInterpreterService, PythonInterpreter } from '../../../interpreter/contracts';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { JupyterInterpreterConfigurationResponse, JupyterInterpreterConfigurationService } from './jupyterInterpreterConfiguration';
import { JupyterInterpreterSelector } from './jupyterInterpreterSelector';
import { JupyterInterpreterStateStore } from './jupyterInterpreterStateStore';

@injectable()
export class JupyterInterpreterService {
    private _selectedInterpreterPath?: string;
    private _onDidChangeInterpreter = new EventEmitter<PythonInterpreter>();
    public get onDidChangeInterpreter(): Event<PythonInterpreter> {
        return this._onDidChangeInterpreter.event;
    }

    constructor(
        @inject(JupyterInterpreterStateStore) private readonly interpreterSelectionState: JupyterInterpreterStateStore,
        @inject(JupyterInterpreterSelector) private readonly jupyterInterpreterSelector: JupyterInterpreterSelector,
        @inject(JupyterInterpreterConfigurationService) private readonly interpreterConfiguration: JupyterInterpreterConfigurationService,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}
    /**
     * Gets the selected interpreter configured to run Jupyter.
     *
     * @returns {(Promise<PythonInterpreter | undefined>)}
     * @memberof JupyterInterpreterService
     */
    public async getSelectedInterpreter(): Promise<PythonInterpreter | undefined> {
        const pythonPath = this._selectedInterpreterPath || this.interpreterSelectionState.selectedPythonPath;
        if (!pythonPath) {
            return;
        }

        return this.interpreterService.getInterpreterDetails(pythonPath, undefined);
    }
    /**
     * Selects and interpreter to run jupyter server.
     * Validates and configures the interpreter.
     * Once completed, the interpreter is stored in settings, else user can select another interpreter.
     *
     * @returns {(Promise<PythonInterpreter | undefined>)}
     * @memberof JupyterInterpreterService
     */
    public async selectInterpreter(): Promise<PythonInterpreter | undefined> {
        const interpreter = await this.jupyterInterpreterSelector.selectInterpreter();
        if (!interpreter) {
            sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'notSelected' });
            return;
        }

        const result = await this.interpreterConfiguration.configureInterpreter(interpreter);
        switch (result) {
            case JupyterInterpreterConfigurationResponse.ok: {
                this._onDidChangeInterpreter.fire(interpreter);
                this.interpreterSelectionState.updateSelectedPythonPath((this._selectedInterpreterPath = interpreter.path));
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'selected' });
                return interpreter;
            }
            case JupyterInterpreterConfigurationResponse.cancel:
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'installationCancelled' });
                return;
            default:
                return this.selectInterpreter();
        }
    }
}
