/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Activation event fired before the importer list is read, so extensions that contribute importers
 * activate in time to register them. Contributing extensions declare it in `activationEvents`.
 */
export const DATA_IMPORTER_ACTIVATION_EVENT = 'onPositronDataExplorerImport';

/**
 * The declarative half of an importer: what it is called, what language its code is written in, and
 * which file extensions it can read. Extensions cannot read every format (base R cannot read XLSX),
 * so the extension list is what keeps unusable options off the offer.
 */
export interface IDataImporterMetadata {
	/** The language the generated code is written in, e.g. 'python'. */
	readonly languageId: string;

	/** A human-readable name for the importer, e.g. 'Python (pandas)'. */
	readonly displayName: string;

	/** File extensions this importer can read, without a leading dot, e.g. ['csv', 'tsv']. */
	readonly fileExtensions: readonly string[];

	/**
	 * Words this importer's language will not let you assign to, e.g. 'class' for Python or 'if'
	 * for R. Positron suffixes a derived default that collides with one, so an importer that omits
	 * the list gets 'class = ...' offered for a file named class.csv.
	 */
	readonly reservedNames?: readonly string[];
}

/**
 * Import options that are not part of the file's identity. This bag is the seam for future options
 * (delimiter, skip rows, NA strings, column types, encoding); today only the two below exist.
 */
export interface IDataImportOptions {
	/** Whether the first row holds column names. Defaults to true when absent. */
	readonly hasHeaderRow?: boolean;

	/** The worksheet to read, for formats that have sheets. */
	readonly sheetName?: string;
}

/**
 * A request to generate the code that loads one file into one variable.
 */
export interface IDataImportRequest {
	/** The original file, not the positron-data-explorer URI. */
	readonly fileUri: URI;

	/**
	 * The target variable name. Positron's derived default is always assignable, but the user is
	 * free to replace it with anything, so an importer should embed this as given rather than
	 * assume it parses.
	 */
	readonly variableName: string;

	/** Format and parsing options. */
	readonly options: IDataImportOptions;
}

/**
 * The wire form of {@link IDataImportRequest}, sent to the extension host.
 */
export interface IDataImportRequestDto {
	readonly fileUri: UriComponents;
	readonly variableName: string;
	readonly options: IDataImportOptions;
}

/**
 * Generated code, plus anything the importer could not express. Silently dropping a filter would
 * hand someone a different dataframe than the one on screen, so the omissions travel with the code.
 */
export interface IDataImportResult {
	/** The generated code, ready to run in a console. */
	readonly code: string;

	/** Human-readable descriptions of anything in the request the importer could not translate. */
	readonly unsupported?: string[];
}

/**
 * A registered importer: its metadata plus its code generator.
 */
export interface IDataImporter extends IDataImporterMetadata {
	/**
	 * Generates the code that loads the requested file.
	 * @param request The file, target variable name, and options.
	 * @returns The generated code, or undefined if the importer declined to generate any.
	 */
	generateCode(request: IDataImportRequest): Promise<IDataImportResult | undefined>;
}

export const IPositronDataImporterRegistry = createDecorator<IPositronDataImporterRegistry>('positronDataImporterRegistry');

/**
 * Holds the data importers contributed by extensions, queryable by file extension.
 */
export interface IPositronDataImporterRegistry {
	readonly _serviceBrand: undefined;

	/**
	 * Registers an importer.
	 * @param importer The importer to register.
	 * @returns A disposable that unregisters it.
	 */
	registerImporter(importer: IDataImporter): IDisposable;

	/**
	 * Returns the importers that can read a file extension, sorted by display name. Activates
	 * contributing extensions first, so a dormant extension's importer is not missed.
	 * @param fileExtension The extension to match, with or without a leading dot; case-insensitive.
	 */
	getImporters(fileExtension: string): Promise<IDataImporter[]>;
}
