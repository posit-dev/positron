/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { MCP_ENABLE_KEY } from '../common/positronMcpConfiguration.js';
import { PositronMcpWorkspace } from './positronMcpWorkspace.js';

const STATUS_ID = 'status.positronMcp';
const SHOW_STATUS_COMMAND = 'positron.mcp.showStatus';

/**
 * Status bar entry for the Positron MCP server. Hidden while the server is
 * disabled (the default); when enabled it shows a plug, switching to a warning
 * when something needs attention -- the workspace has no `.mcp.json` (the server
 * runs but this project can't reach it). Clicking it opens the status panel.
 *
 * It refreshes on the things that change what it reports: the enable setting,
 * the first folder's `.mcp.json`, and which folders are open.
 */
export class PositronMcpStatusBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronMcpStatusBar';

	private readonly _entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly _configWatcher = this._register(new MutableDisposable());
	private readonly _workspace: PositronMcpWorkspace;

	constructor(
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		super();
		this._workspace = new PositronMcpWorkspace(this._fileService, this._workspaceContextService);

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(MCP_ENABLE_KEY)) {
				this._update();
			}
		}));
		this._register(this._workspaceContextService.onDidChangeWorkspaceFolders(() => {
			this._watchConfigFile();
			this._update();
		}));

		this._watchConfigFile();
		this._update();
	}

	/** Watch the first folder's `.mcp.json` so the entry tracks config changes. */
	private _watchConfigFile(): void {
		const folder = this._workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!folder) {
			this._configWatcher.clear();
			return;
		}
		const configUri = URI.joinPath(folder, '.mcp.json');
		const watcher = this._fileService.createWatcher(folder, { recursive: false, excludes: [] });
		this._configWatcher.value = watcher;
		watcher.onDidChange(e => {
			if (e.contains(configUri)) {
				this._update();
			}
		});
	}

	private async _update(): Promise<void> {
		const enabled = this._configurationService.getValue<boolean>(MCP_ENABLE_KEY) === true;
		if (!enabled) {
			this._entry.clear();
			return;
		}

		const configState = await this._workspace.getConfigState();
		const needsAttention = configState === 'not-configured';
		const entry: IStatusbarEntry = {
			name: localize('positron.mcp.statusbar.name', "Positron MCP"),
			text: needsAttention ? '$(warning) MCP' : '$(plug) MCP',
			ariaLabel: localize('positron.mcp.statusbar.ariaLabel', "Positron MCP server"),
			tooltip: needsAttention
				? localize('positron.mcp.statusbar.tooltip.attention', "MCP server enabled, but this workspace has no .mcp.json. Click for details.")
				: localize('positron.mcp.statusbar.tooltip.ok', "MCP server enabled. Click for details."),
			command: SHOW_STATUS_COMMAND,
			kind: needsAttention ? 'warning' : 'standard',
		};

		if (this._entry.value) {
			this._entry.value.update(entry);
		} else {
			this._entry.value = this._statusbarService.addEntry(entry, STATUS_ID, StatusbarAlignment.RIGHT, 100);
		}
	}
}
