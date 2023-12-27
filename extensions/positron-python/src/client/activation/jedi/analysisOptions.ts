// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import { WorkspaceFolder } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { IConfigurationService, Resource } from '../../common/types';

import { IEnvironmentVariablesProvider } from '../../common/variables/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { LanguageServerAnalysisOptionsWithEnv } from '../common/analysisOptions';
import { ILanguageServerOutputChannel } from '../types';

/* eslint-disable @typescript-eslint/explicit-module-boundary-types, class-methods-use-this */

export class JediLanguageServerAnalysisOptions extends LanguageServerAnalysisOptionsWithEnv {
    private resource: Resource | undefined;

    constructor(
        envVarsProvider: IEnvironmentVariablesProvider,
        lsOutputChannel: ILanguageServerOutputChannel,
        private readonly configurationService: IConfigurationService,
        workspace: IWorkspaceService,
    ) {
        super(envVarsProvider, lsOutputChannel, workspace);
        this.resource = undefined;
    }

    public async initialize(resource: Resource, interpreter: PythonEnvironment | undefined) {
        this.resource = resource;
        return super.initialize(resource, interpreter);
    }

    protected getWorkspaceFolder(): WorkspaceFolder | undefined {
        return this.workspace.getWorkspaceFolder(this.resource);
    }

    protected async getInitializationOptions() {
        const pythonSettings = this.configurationService.getSettings(this.resource);
        const workspacePath = this.getWorkspaceFolder()?.uri.fsPath;
        const extraPaths = pythonSettings.autoComplete
            ? pythonSettings.autoComplete.extraPaths.map((extraPath) => {
                  if (path.isAbsolute(extraPath)) {
                      return extraPath;
                  }
                  return workspacePath ? path.join(workspacePath, extraPath) : '';
              })
            : [];

        if (workspacePath) {
            extraPaths.unshift(workspacePath);
        }

        const distinctExtraPaths = extraPaths
            .filter((value) => value.length > 0)
            .filter((value, index, self) => self.indexOf(value) === index);

        return {
            markupKindPreferred: 'markdown',
            completion: {
                resolveEagerly: false,
                disableSnippets: true,
            },
            diagnostics: {
                enable: true,
                didOpen: true,
                didSave: true,
                didChange: true,
            },
            hover: {
                disable: {
                    keyword: {
                        all: true,
                    },
                },
            },
            // --- Start Positron ---
            // Auto-import fastai. Without this setting, most language server features will cause
            // the process to hang, maxing out the CPU, and resulting in the kernel becoming non-
            // responsive. This disables goto definition but keeps completions and signatures.
            // See: https://github.com/davidhalter/jedi/issues/1721.
            jediSettings: {
                autoImportModules: ['fastai', 'fastcore'],
            },
            // --- End Positron ---
            workspace: {
                extraPaths: distinctExtraPaths,
                symbols: {
                    // 0 means remove limit on number of workspace symbols returned
                    maxSymbols: 0,
                },
            },
        };
    }
}
