/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { PlotRenderFormat } from '../../../services/positronPlots/common/positronPlots.js';

interface SavedPlotLocation {
	directory: string;
	format?: PlotRenderFormat;
}

/**
 * Remembers the folder and format of the last plot save, per workspace, until
 * Positron quits. Ephemeral state is used so the value survives window reloads.
 */
export class PlotSaveMemory {
	private readonly _key: string;

	constructor(
		private readonly _ephemeralState: Pick<IEphemeralStateService, 'getItem' | 'setItem'>,
		private readonly _fileService: Pick<IFileService, 'exists'>,
		workspaceId: string,
	) {
		this._key = `positron.plots.lastSaveLocation.${workspaceId}`;
	}

	/** The last folder saved to, or the fallback if there is none or it no longer exists. */
	async getDirectory(fallback: URI): Promise<URI> {
		const saved = await this._ephemeralState.getItem<SavedPlotLocation>(this._key);
		if (saved) {
			const directory = URI.parse(saved.directory);
			if (await this._fileService.exists(directory)) {
				return directory;
			}
		}
		return fallback;
	}

	async getFormat(): Promise<PlotRenderFormat | undefined> {
		const saved = await this._ephemeralState.getItem<SavedPlotLocation>(this._key);
		return saved?.format;
	}

	/** Records a successful save. Omit the format to keep the previous one. */
	async remember(directory: URI, format?: PlotRenderFormat): Promise<void> {
		format ??= await this.getFormat();
		const saved: SavedPlotLocation = { directory: directory.toString(), format };
		await this._ephemeralState.setItem(this._key, saved);
	}
}
