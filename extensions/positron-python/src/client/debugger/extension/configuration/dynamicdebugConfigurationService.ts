// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as path from 'path';
import { inject, injectable } from 'inversify';
import { CancellationToken, DebugConfiguration, WorkspaceFolder } from 'vscode';
import { IDynamicDebugConfigurationService } from '../types';
import { IFileSystem } from '../../../common/platform/types';
import { IPathUtils } from '../../../common/types';
import { DebuggerTypeName } from '../../constants';

const workspaceFolderToken = '${workspaceFolder}';

@injectable()
export class DynamicPythonDebugConfigurationService implements IDynamicDebugConfigurationService {
    constructor(@inject(IFileSystem) private fs: IFileSystem, @inject(IPathUtils) private pathUtils: IPathUtils) {}

    public async provideDebugConfigurations(
        folder: WorkspaceFolder,
        _token?: CancellationToken,
    ): Promise<DebugConfiguration[] | undefined> {
        const providers = [];

        providers.push({
            name: 'Dynamic Python: File',
            type: DebuggerTypeName,
            request: 'launch',
            program: '${file}',
            justMyCode: true,
        });

        const djangoManagePath = await this.fs.search(path.join(folder.uri.fsPath, '**/manage.py'));
        if (djangoManagePath.length) {
            const managePath = path.relative(folder.uri.fsPath, djangoManagePath[0]);
            providers.push({
                name: 'Dynamic Python: Django',
                type: DebuggerTypeName,
                request: 'launch',
                program: `${workspaceFolderToken}${this.pathUtils.separator}${managePath}`,
                args: ['runserver'],
                django: true,
                justMyCode: true,
            });
        }
        return providers;
    }
}
