/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from connections.json; do not edit.
//

import { Event } from 'vs/base/common/event';
import { PositronBaseComm } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

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

/**
 * Event: Request to focus the Connections pane
 */
export interface FocusEvent {
}

/**
 * Event: Request the UI to refresh the connection information
 */
export interface UpdateEvent {
}

export enum ConnectionsFrontendEvent {
	Focus = 'focus',
	Update = 'update'
}

export class PositronConnectionsComm extends PositronBaseComm {
	constructor(instance: IRuntimeClientInstance<any, any>) {
		super(instance);
		this.onDidFocus = super.createEventEmitter('focus', []);
		this.onDidUpdate = super.createEventEmitter('update', []);
	}

	/**
	 * List objects within a data source
	 *
	 * List objects within a data source, such as schemas, catalogs, tables
	 * and views.
	 *
	 * @param path The path to object that we want to list children.
	 * @param timeout Timeout in milliseconds after which to error if the
	 * server does not respond
	 *
	 * @returns Array of objects names and their kinds.
	 */
	listObjects(path: Array<ObjectSchema>, timeout?: number): Promise<Array<ObjectSchema>> {
		return super.performRpc('list_objects', ['path'], [path], timeout);
	}

	/**
	 * List fields of an object
	 *
	 * List fields of an object, such as columns of a table or view.
	 *
	 * @param path The path to object that we want to list fields.
	 * @param timeout Timeout in milliseconds after which to error if the
	 * server does not respond
	 *
	 * @returns Array of field names and data types.
	 */
	listFields(path: Array<ObjectSchema>, timeout?: number): Promise<Array<FieldSchema>> {
		return super.performRpc('list_fields', ['path'], [path], timeout);
	}

	/**
	 * Check if an object contains data
	 *
	 * Check if an object contains data, such as a table or view.
	 *
	 * @param path The path to object that we want to check if it contains
	 * data.
	 * @param timeout Timeout in milliseconds after which to error if the
	 * server does not respond
	 *
	 * @returns Boolean indicating if the object contains data.
	 */
	containsData(path: Array<ObjectSchema>, timeout?: number): Promise<boolean> {
		return super.performRpc('contains_data', ['path'], [path], timeout);
	}

	/**
	 * Get icon of an object
	 *
	 * Get icon of an object, such as a table or view.
	 *
	 * @param path The path to object that we want to get the icon.
	 * @param timeout Timeout in milliseconds after which to error if the
	 * server does not respond
	 *
	 * @returns The icon of the object.
	 */
	getIcon(path: Array<ObjectSchema>, timeout?: number): Promise<string> {
		return super.performRpc('get_icon', ['path'], [path], timeout);
	}

	/**
	 * Preview object data
	 *
	 * Preview object data, such as a table or view.
	 *
	 * @param path The path to object that we want to preview.
	 * @param timeout Timeout in milliseconds after which to error if the
	 * server does not respond
	 *
	 * @returns undefined
	 */
	previewObject(path: Array<ObjectSchema>, timeout?: number): Promise<null> {
		return super.performRpc('preview_object', ['path'], [path], timeout);
	}


	/**
	 * Request to focus the Connections pane
	 */
	onDidFocus: Event<FocusEvent>;
	/**
	 * Request the UI to refresh the connection information
	 */
	onDidUpdate: Event<UpdateEvent>;
}

