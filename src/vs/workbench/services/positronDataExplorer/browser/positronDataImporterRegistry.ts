/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IExtensionService } from '../../extensions/common/extensions.js';
import {
	DATA_IMPORTER_ACTIVATION_EVENT,
	IDataImporter,
	IPositronDataImporterRegistry
} from '../common/positronDataImporterRegistry.js';

/**
 * Normalizes a file extension for comparison: no leading dot, lower case. Importers declare
 * extensions by hand, so 'CSV' and '.csv' both have to match a file named flights.csv.
 */
function normalizeFileExtension(fileExtension: string): string {
	return fileExtension.replace(/^\./, '').toLowerCase();
}

/**
 * Holds the data importers contributed by extensions. Registrations arrive from the extension host
 * via MainThreadDataExplorer; queries come from the Import Data dialog.
 */
export class PositronDataImporterRegistry extends Disposable implements IPositronDataImporterRegistry {

	declare readonly _serviceBrand: undefined;

	/** Registered importers, in registration order. */
	private readonly _importers = new Set<IDataImporter>();

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService
	) {
		super();
	}

	registerImporter(importer: IDataImporter): IDisposable {
		this._importers.add(importer);
		return toDisposable(() => {
			this._importers.delete(importer);
		});
	}

	async getImporters(fileExtension: string): Promise<IDataImporter[]> {
		// Activate contributing extensions first: a dormant extension has registered nothing yet, and
		// an importer missing from the list is indistinguishable from an importer that does not exist.
		await this._extensionService.activateByEvent(DATA_IMPORTER_ACTIVATION_EVENT);

		const normalized = normalizeFileExtension(fileExtension);
		const matches: IDataImporter[] = [];
		for (const importer of this._importers) {
			if (importer.fileExtensions.some(candidate => normalizeFileExtension(candidate) === normalized)) {
				matches.push(importer);
			}
		}

		// Sort by display name, so the dialog's package list does not depend on which extension
		// happened to activate first. Every display name leads with its language ('Python (pandas)',
		// 'R (readr)'), so this also groups the list by language.
		matches.sort((one, other) => one.displayName.localeCompare(other.displayName));
		return matches;
	}
}

registerSingleton(IPositronDataImporterRegistry, PositronDataImporterRegistry, InstantiationType.Delayed);
