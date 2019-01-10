// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { IInterpreterService, InterpreterType } from '../../../interpreter/contracts';
import { ITerminalActivationCommandProvider, TerminalShellType } from '../types';

@injectable()
export class PipEnvActivationCommandProvider implements ITerminalActivationCommandProvider {
    constructor(@inject(IInterpreterService) private readonly interpreterService: IInterpreterService) { }

    public isShellSupported(_targetShell: TerminalShellType): boolean {
        return true;
    }

    public async getActivationCommands(resource: Uri | undefined, _: TerminalShellType): Promise<string[] | undefined> {
        const interpreter = await this.interpreterService.getActiveInterpreter(resource);
        if (!interpreter || interpreter.type !== InterpreterType.Pipenv) {
            return;
        }

        return ['pipenv shell'];
    }
}
