/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { positronConfigurationNodeBase } from '../../languageRuntime/common/languageRuntime.js';
import { PositronDataExplorerLayout } from './interfaces/positronDataExplorerService.js';

// Key for the configuration setting
export const USE_DATA_EXPLORER_SUMMARY_COLLAPSED_KEY =
	'dataExplorer.summaryCollapsed';
export const USE_DATA_EXPLORER_SUMMARY_LAYOUT_KEY =
	'dataExplorer.summaryLayout';
export const DATA_EXPLORER_ENABLE_PREVIEW_KEY =
	'dataExplorer.enablePreview';
export const DATA_EXPLORER_FILE_READERS_KEY =
	'dataExplorer.fileReaders';

/** File extension keys of `dataExplorer.fileReaders`: lower case, no dot. */
const FILE_READER_EXTENSION_PATTERN = '^[a-z0-9_]+$';
/** `[repo/]extension[:function]`, or empty to turn a reader off. */
const FILE_READER_VALUE_PATTERN = '^(((core|community)/)?[a-z0-9_]+(:[a-z0-9_]+)?)?$';

/**
 * Returns the file extensions (lower case, without the dot) that
 * `dataExplorer.fileReaders` maps to a DuckDB extension reader.
 */
export function DataExplorerFileReaderExtensions(
	configurationService: IConfigurationService
): string[] {
	const readers = configurationService.getValue<Record<string, unknown>>(DATA_EXPLORER_FILE_READERS_KEY);
	if (!readers || typeof readers !== 'object') {
		return [];
	}
	const extensionPattern = new RegExp(FILE_READER_EXTENSION_PATTERN);
	const valuePattern = new RegExp(FILE_READER_VALUE_PATTERN);
	return Object.entries(readers)
		.filter(([ext, reader]) => extensionPattern.test(ext) && typeof reader === 'string' && reader !== '' && valuePattern.test(reader))
		.map(([ext]) => ext);
}

export function DataExplorerSummaryCollapseEnabled(
	configurationService: IConfigurationService
) {
	return Boolean(
		configurationService.getValue(USE_DATA_EXPLORER_SUMMARY_COLLAPSED_KEY)
	);
}

export function DefaultDataExplorerSummaryLayout(
	configurationService: IConfigurationService
) {
	if (String(
		configurationService.getValue(USE_DATA_EXPLORER_SUMMARY_LAYOUT_KEY)
	) === 'left') {
		return PositronDataExplorerLayout.SummaryOnLeft;
	} else {
		return PositronDataExplorerLayout.SummaryOnRight;
	}
}

export function DataExplorerPreviewEnabled(
	configurationService: IConfigurationService
) {
	return Boolean(
		configurationService.getValue(DATA_EXPLORER_ENABLE_PREVIEW_KEY)
	);
}

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({ // for summary collapse
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[USE_DATA_EXPLORER_SUMMARY_COLLAPSED_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.dataExplorerSummaryCollapsed',
				'Collapse Data Explorer Summary Panel by default.'
			),
		},
	},
});
configurationRegistry.registerConfiguration({ // for summary layout
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[USE_DATA_EXPLORER_SUMMARY_LAYOUT_KEY]: {
			type: 'string',
			default: 'left', // Default value (can be "left" or "right")
			enum: ['left', 'right'], // Define possible values
			markdownDescription: localize(
				'positron.dataExplorerSummaryLayout',
				'Select the position of the Data Explorer Summary Panel (left or right).'
			),
		},
	},
});
configurationRegistry.registerConfiguration({ // for preview mode
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[DATA_EXPLORER_ENABLE_PREVIEW_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.dataExplorerEnablePreview',
				'Controls whether preview mode is used for Data Explorer and Object Explorer tabs, similar to `#workbench.editor.enablePreview#` for regular editors. Preview tabs are shown in italics and are replaced by the next preview tab opened. Double-clicking or clicking the \'Keep Open\' option in its label context menu pins the tab.'
			),
		},
	},
});
configurationRegistry.registerConfiguration({ // for DuckDB extension file readers
	...positronConfigurationNodeBase,
	// Not workspace-scoped, so a workspace can't make Positron download extensions.
	scope: ConfigurationScope.MACHINE,
	properties: {
		[DATA_EXPLORER_FILE_READERS_KEY]: {
			type: 'object',
			propertyNames: { pattern: FILE_READER_EXTENSION_PATTERN },
			additionalProperties: { type: 'string', pattern: FILE_READER_VALUE_PATTERN },
			default: {
				// SAS, SPSS, Stata
				'sas7bdat': 'read_stat',
				'xpt': 'read_stat',
				'sav': 'read_stat',
				'zsav': 'read_stat',
				'por': 'read_stat',
				'dta': 'read_stat',
				// Apache ORC
				'orc': 'orc:read_orc',
				// OpenDocument spreadsheets
				'ods': 'rusty_sheet:read_sheet',
				// Geospatial
				'shp': 'core/spatial:st_read',
				'geojson': 'core/spatial:st_read',
				'gpkg': 'core/spatial:st_read',
				'fgb': 'core/spatial:st_read',
				'kml': 'core/spatial:st_read',
			},
			restricted: true,
			markdownDescription: localize(
				'positron.dataExplorerFileReaders',
				'Maps a file extension (without the dot) to the DuckDB extension that reads it in the Data Explorer, as `[repository/]extension[:function]`. The repository is `community` (default) or `core`, and the function defaults to the extension name. The extension is downloaded the first time a matching file is opened. Set a value to an empty string to turn off a default reader.'
			),
		},
	},
});
