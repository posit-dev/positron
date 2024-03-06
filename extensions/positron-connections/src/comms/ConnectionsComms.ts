/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// This file is a copy of positronConnectionsComms.ts modifying the PositronConnectionsComm class
// to extend from PositronBaseComm instead of the original PositronBaseComm class and taking a
// positron.RuntimeClientInstance instance as a parameter in the constructor instead of an
// IRuntimeClientInstance instance.

import { PositronBaseComm } from './BaseComm';
import * as positron from 'positron';

//
// AUTO-GENERATED from connections.json; do not edit.
//

/**
 * ObjectSchema in Schemas
 */
export interface ObjectSchema {
	/**
	 * Name of the underlying object
	 */
	name: string;

	/**
	 * The object type (table, catalog, schema)
	 */
	kind: string;

}

/**
 * FieldSchema in Schemas
 */
export interface FieldSchema {
	/**
	 * Name of the field
	 */
	name: string;

	/**
	 * The field data type
	 */
	dtype: string;

}

export class PositronConnectionsComm extends PositronBaseComm {
	constructor(public instance: positron.RuntimeClientInstance) {
		super(instance);
	}

	/**
	 * List objects within a data source
	 *
	 * List objects within a data source, such as schemas, catalogs, tables
	 * and views.
	 *
	 * @param path The path to object that we want to list children.
	 *
	 * @returns Array of objects names and their kinds.
	 */
	listObjects(path: Array<ObjectSchema>): Promise<Array<ObjectSchema>> {
		return super.performRpc('list_objects', ['path'], [path]);
	}

	/**
	 * List fields of an object
	 *
	 * List fields of an object, such as columns of a table or view.
	 *
	 * @param path The path to object that we want to list fields.
	 *
	 * @returns Array of field names and data types.
	 */
	listFields(path: Array<ObjectSchema>): Promise<Array<FieldSchema>> {
		return super.performRpc('list_fields', ['path'], [path]);
	}

	/**
	 * Check if an object contains data
	 *
	 * Check if an object contains data, such as a table or view.
	 *
	 * @param path The path to object that we want to check if it contains
	 * data.
	 *
	 * @returns Boolean indicating if the object contains data.
	 */
	containsData(path: Array<ObjectSchema>): Promise<boolean> {
		return super.performRpc('contains_data', ['path'], [path]);
	}

	/**
	 * Get icon of an object
	 *
	 * Get icon of an object, such as a table or view.
	 *
	 * @param path The path to object that we want to get the icon.
	 *
	 * @returns The icon of the object.
	 */
	getIcon(path: Array<ObjectSchema>): Promise<string> {
		return super.performRpc('get_icon', ['path'], [path]);
	}

	/**
	 * Preview object data
	 *
	 * Preview object data, such as a table or view.
	 *
	 * @param path The path to object that we want to preview.
	 *
	 * @returns undefined
	 */
	previewObject(path: Array<ObjectSchema>): Promise<null> {
		return super.performRpc('preview_object', ['path'], [path]);
	}

}
