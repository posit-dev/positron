/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export enum InputType {
	String = 'string',
	Number = 'number',
	Option = 'option',
}

export interface Input {
	// The unique identifier for the input.
	id: string;
	// A human-readable label for the input.
	label: string;
	// The type of the input.
	type: InputType;
	// Options, if the input type is an option.
	options?: { 'identifier': string; 'title': string }[];
	// The default value for the input.
	value?: string;
}

export interface Driver {
	// The unique identifier for the driver.
	driverId: string;
	// The language identifier for the driver.
	// Drivers are grouped by language, not by runtime.
	languageId: string;
	// A human-readable name for the driver.
	name: string;
	// The base64-encoded SVG icon for the driver.
	base64EncodedIconSvg?: string;
	// The inputs required to create a connection.
	// For instance, a connection might require a username
	// and password.
	inputs: Array<Input>;
	// Generates the connection code based on the inputs.
	generateCode?: (inputs: Array<Input>) => string;
	// Connect session
	connect?: (code: string) => Promise<void>;
	// Checks if the dependencies for the driver are installed
	// and functioning.
	checkDependencies?: () => Promise<boolean>;
	// Installs the dependencies for the driver.
	// For instance, R packages would install the required
	// R packages, and or other dependencies.
	installDependencies?: () => Promise<boolean>;
}
