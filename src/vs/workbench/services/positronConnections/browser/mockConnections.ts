/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronConnectionInstance, IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';

export class MockedConnectionInstance implements IPositronConnectionInstance {
	constructor(private readonly clientId: string) { }

	getClientId() {
		return this.clientId;
	}

	getChildren() {
		return [
			new MockedConnectionItem(),
			new MockedConnectionItem(),
			new MockedConnectionItem(),
		];
	}

	hasChildren() {
		return true;
	}

	name() {
		return 'SQL Lite Connection 1';
	}

	icon() {
		return 'database';
	}

	expanded() {
		return false;
	}
}

class MockedConnectionItem implements IPositronConnectionItem {
	name() {
		return 'children 1';
	}

	getChildren() {
		return [];
	}

	hasChildren(): boolean {
		return false;
	}

	icon() {
		return 'database';
	}

	expanded() {
		return false;
	}
}

