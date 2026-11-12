/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { PlotRenderFormat } from '../../../services/positronPlots/common/positronPlots.js';

export type PlotSaveMemoryFileService = { stat(uri: URI): Promise<{ isDirectory: boolean }> };

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
		private readonly _fileService: PlotSaveMemoryFileService,
		workspaceId: string,
	) {
		this._key = `positron.plots.lastSaveLocation.${workspaceId}`;
	}

	/** The last folder and format saved to. Uses the fallback folder if there is none or it is no longer a folder. */
	async get(fallback: URI): Promise<{ directory: URI; format?: PlotRenderFormat }> {
		const saved = await this._read();
		const directory = saved ? URI.parse(saved.directory) : undefined;
		return {
			directory: directory && await this._isDirectory(directory) ? directory : fallback,
			format: saved?.format,
		};
	}

	/** Records a successful save. Omit the format to keep the previous one. */
	async remember(directory: URI, format?: PlotRenderFormat): Promise<void> {
		format ??= (await this._read())?.format;
		const saved: SavedPlotLocation = { directory: directory.toString(), format };
		try {
			await this._ephemeralState.setItem(this._key, saved);
		} catch {
			// The plot is already saved; losing the memory is harmless.
		}
	}

	// A failed read must not block the save, e.g. web with no remote connection.
	private async _read(): Promise<SavedPlotLocation | undefined> {
		try {
			return await this._ephemeralState.getItem<SavedPlotLocation>(this._key);
		} catch {
			return undefined;
		}
	}

	private async _isDirectory(uri: URI): Promise<boolean> {
		try {
			return (await this._fileService.stat(uri)).isDirectory;
		} catch {
			return false;
		}
	}
}
