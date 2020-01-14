// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IApplicationShell } from '../../../common/application/types';
import { ProductNames } from '../../../common/installer/productNames';
import { IInstaller, InstallerResponse, Product } from '../../../common/types';
import { Common, DataScience } from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import { PythonInterpreter } from '../../../interpreter/contracts';

export enum JupyterInterpreterConfigurationResponse {
    ok,
    selectAnotherInterpreter,
    cancel
}

/**
 * Responsible for configuration a Python interpreter to run Jupyter.
 * If required modules aren't installed, will prompt user to install them or select another interpreter.
 *
 * @export
 * @class JupyterInterpreterConfigurationService
 */
@injectable()
export class JupyterInterpreterConfigurationService {
    constructor(@inject(IApplicationShell) private readonly applicationShell: IApplicationShell, @inject(IInstaller) private readonly installer: IInstaller) {}
    /**
     * Configures the python interpreter to ensure it can run Jupyter server by installing any missing dependencies.
     * If user opts not to isntall they can opt to select another interpreter.
     *
     * @param {PythonInterpreter} interpreter
     * @returns {Promise<JupyterInterpreterConfigurationResponse>}
     * @memberof JupyterInterpreterConfigurationService
     */
    public async configureInterpreter(interpreter: PythonInterpreter): Promise<JupyterInterpreterConfigurationResponse> {
        const productsToInstall = await this.dependenciesNotInstalled(interpreter);
        if (productsToInstall.length === 0) {
            return JupyterInterpreterConfigurationResponse.ok;
        }

        const names = productsToInstall
            .map(product => ProductNames.get(product))
            .filter(name => !!name)
            .map(name => name as string);
        const message = DataScience.libraryNotInstalled().format(names.join(` ${Common.and} `));

        const selection = await this.applicationShell.showErrorMessage(message, DataScience.jupyterInstall(), DataScience.selectDifferentJupyterInterpreter(), Common.cancel());

        switch (selection) {
            case DataScience.jupyterInstall(): {
                let productToInstall = productsToInstall.shift();
                while (productToInstall) {
                    const response = await this.installer.install(productToInstall, interpreter);
                    if (response === InstallerResponse.Installed) {
                        productToInstall = productsToInstall.shift();
                        continue;
                    } else {
                        return JupyterInterpreterConfigurationResponse.cancel;
                    }
                }

                return JupyterInterpreterConfigurationResponse.ok;
            }

            case DataScience.selectDifferentJupyterInterpreter(): {
                return JupyterInterpreterConfigurationResponse.selectAnotherInterpreter;
            }

            default:
                return JupyterInterpreterConfigurationResponse.cancel;
        }
    }
    private async dependenciesNotInstalled(interpreter: PythonInterpreter): Promise<Product[]> {
        const notInstalled: Product[] = [];
        await Promise.all([
            this.installer.isInstalled(Product.jupyter, interpreter).then(installed => (installed ? noop() : notInstalled.push(Product.jupyter))),
            this.installer.isInstalled(Product.notebook, interpreter).then(installed => (installed ? noop() : notInstalled.push(Product.notebook)))
        ]);
        return notInstalled;
    }
}
