/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CycloneDX 1.4 SBOM types (simplified subset)
 */

export interface BOM {
	bomFormat: string;
	specVersion: string;
	serialNumber: string;
	version: number;
	metadata: Metadata;
	components: Component[];
	dependencies: Dependency[];
}

export interface Metadata {
	timestamp: string;
	tools: Tool[];
	component: Component;
}

export interface Tool {
	vendor: string;
	name: string;
	version?: string;
}

export interface Component {
	"bom-ref": string;
	type: string;
	name: string;
	version?: string;
	purl?: string;
	description?: string;
	licenses?: License[];
	hashes?: Hash[];
	externalReferences?: ExternalReference[];
}

export interface License {
	license?: {
		id?: string;
		name?: string;
		url?: string;
	};
	expression?: string;
}

export interface Hash {
	alg: string;
	content: string;
}

export interface ExternalReference {
	type: string;
	url: string;
}

export interface Dependency {
	ref: string;
	dependsOn?: string[];
}

/**
 * Project definition for SBOM generation
 */
export interface Project {
	name: string;
	path: string;
	type: 'npm' | 'rust';
}
