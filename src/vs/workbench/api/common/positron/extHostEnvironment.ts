/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { EnvironmentContributionFilter, EnvironmentVariableAction, EnvironmentVariableContribution } from 'positron';
import * as extHostProtocol from './extHost.positron.protocol.js';
import { IExtHostWorkspace } from '../extHostWorkspace.js';
import { URI } from '../../../../base/common/uri.js';

export class ExtHostEnvironment implements extHostProtocol.ExtHostEnvironmentShape {

	private readonly _proxy: extHostProtocol.MainThreadEnvironmentShape;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly _workspace: IExtHostWorkspace
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadEnvironment);
	}

	public async getEnvironmentContributions(filter?: EnvironmentContributionFilter): Promise<Record<string, EnvironmentVariableAction[]>> {
		const contributions = await this._proxy.$getEnvironmentContributions(filter);
		return contributions;
	}

	public async getEnvironmentVariableContributions(): Promise<EnvironmentVariableContribution[]> {
		const contributions = await this._proxy.$getEnvironmentVariableContributions();
		return contributions.map(c => ({
			extensionId: c.extensionId,
			variable: c.variable,
			type: c.type as vscode.EnvironmentVariableMutatorType,
			value: c.value,
			options: {
				applyAtProcessCreation: c.applyAtProcessCreation,
				applyAtShellIntegration: c.applyAtShellIntegration,
			},
			scope: c.workspaceFolder && { workspaceFolder: this._toWorkspaceFolder(c.workspaceFolder) },
			description: c.description,
			persistent: c.persistent,
			applied: c.applied,
		}));
	}

	private _toWorkspaceFolder(folder: NonNullable<extHostProtocol.IEnvironmentVariableContributionDto['workspaceFolder']>): vscode.WorkspaceFolder {
		const uri = URI.revive(folder.uri);
		// A folder no longer open in the workspace is described as it was.
		return this._workspace.getWorkspaceFolder(uri) ?? { uri, name: folder.name, index: folder.index };
	}
}
