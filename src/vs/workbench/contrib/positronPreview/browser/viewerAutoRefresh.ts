/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Sequencer } from '../../../../base/common/async.js';
import { isWeb } from '../../../../base/common/platform.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IPositronPreviewService } from './positronPreviewSevice.js';
import { POSITRON_VIEWER_AUTO_REFRESH, POSITRON_VIEWER_CAN_AUTO_REFRESH, POSITRON_VIEWER_TOGGLE_AUTO_REFRESH } from './positronPreviewActions.js';

/**
 * The setting for reloading local files that change, shared by the Viewer and
 * the integrated browser. The integrated browser registers it on desktop; web
 * builds don't load the integrated browser, so the Viewer registers it there.
 */
const AUTO_RELOAD_SETTING = 'workbench.browser.autoReloadOnFileChange';

if (isWeb) {
	Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
		...workbenchConfigurationNodeBase,
		properties: {
			[AUTO_RELOAD_SETTING]: {
				type: 'boolean',
				default: true,
				markdownDescription: localize('positron.viewer.autoReloadOnFileChange', "Controls whether the Viewer automatically reloads by default when showing local files that change on disk."),
			}
		}
	});
}

/**
 * Reloads the Viewer when a local file that its content loaded through the
 * Positron Proxy changes on disk. The proxy knows which files the content
 * loaded, so it watches them and tells the Viewer when one changes.
 */
export class ViewerAutoRefresh extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronViewerAutoRefresh';

	private readonly _sequencer = new Sequencer();
	private readonly _overrides = new Map<string, boolean>();
	private readonly _canAutoRefresh: IContextKey<boolean>;
	private readonly _autoRefresh: IContextKey<boolean>;
	private _address: string | undefined;
	private _watchId: string | undefined;

	constructor(
		@IPositronPreviewService private readonly _previewService: IPositronPreviewService,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this._canAutoRefresh = POSITRON_VIEWER_CAN_AUTO_REFRESH.bindTo(contextKeyService);
		this._autoRefresh = POSITRON_VIEWER_AUTO_REFRESH.bindTo(contextKeyService);

		this._register(CommandsRegistry.registerCommand('positronViewer.htmlProxyContentChanged', (_accessor, id: string) => {
			if (id === this._watchId && this.enabled) {
				this._previewService.activePreviewWebview?.surface.reload();
			}
		}));
		this._register(CommandsRegistry.registerCommand(POSITRON_VIEWER_TOGGLE_AUTO_REFRESH, () => {
			if (this._watchId) {
				this._overrides.set(this._watchId, !this.enabled);
				this.updateContext();
			}
		}));
		this._register(this._previewService.onDidChangeNavigationState(() => this.update()));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AUTO_RELOAD_SETTING)) {
				this.updateContext();
			}
		}));
		this._register(toDisposable(() => this.unwatch()));
		this.update();
	}

	private get enabled(): boolean {
		return !!this._watchId &&
			(this._overrides.get(this._watchId) ?? this._configurationService.getValue<boolean>(AUTO_RELOAD_SETTING) !== false);
	}

	/** Watches the files of the active content, when its address changes. */
	private update(): void {
		this._sequencer.queue(async () => {
			const address = this._previewService.activePreviewWebview?.address?.toString(true);
			if (address === this._address) {
				return;
			}
			this._address = address;
			await this.unwatch();
			this._watchId = address ?
				await this._commandService.executeCommand<string>('positronProxy.watchHtmlProxy', address).catch(() => undefined) :
				undefined;
			this.updateContext();
		});
	}

	private async unwatch(): Promise<void> {
		const id = this._watchId;
		this._watchId = undefined;
		if (id) {
			await this._commandService.executeCommand('positronProxy.unwatchHtmlProxy', id).catch(() => undefined);
		}
	}

	private updateContext(): void {
		this._canAutoRefresh.set(!!this._watchId);
		this._autoRefresh.set(this.enabled);
	}
}
