/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { writeFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { BOM, Component, Dependency } from './types';
import { PROJECTS } from './projects';
import {
	createEmptyBom,
	checkForSnyk,
	checkForCargoCyclonedx,
	getPositronVersion,
	findRootComponent
} from './utils';
import { generateNpmSbom, generateRustSbom } from './generators';
import { getBinaryDependencyProjects } from './binary-dependencies';
import { getBootstrapExtensions } from './bootstrap-extensions';

async function main() {
	console.log('=== Positron SBOM Generator ===\n');

	// Check for required tools
	console.log('Checking for required tools...');
	try {
		await checkForSnyk();
		console.log('[OK] Snyk CLI found');
	} catch (error) {
		console.error(`[ERROR] ${error}`);
		process.exit(1);
	}

	try {
		await checkForCargoCyclonedx();
		console.log('[OK] cargo-cyclonedx found');
	} catch (error) {
		console.error(`[ERROR] ${error}`);
		process.exit(1);
	}

	console.log('');

	// Create the root BOM
	const completeBom = createEmptyBom();
	const version = getPositronVersion();

	console.log(`Positron version: ${version}\n`);

	// Add binary dependencies that should be scanned from source
	const binaryProjects = getBinaryDependencyProjects();

	// Add bootstrap extensions from product.json
	const bootstrapProjects = getBootstrapExtensions();

	const allProjects = [...PROJECTS, ...binaryProjects, ...bootstrapProjects];

	console.log(`Generating SBOMs for ${allProjects.length} projects...\n`);
	if (binaryProjects.length > 0) {
		console.log(`  (includes ${binaryProjects.length} binary dependencies scanned from source)`);
	}
	if (bootstrapProjects.length > 0) {
		console.log(`  (includes ${bootstrapProjects.length} bootstrap extensions from product.json)`);
	}
	console.log('');

	const projectBoms: BOM[] = await Promise.all(
		allProjects.map((project) => {
			if (project.type === 'npm') {
				return generateNpmSbom(project);
			} else if (project.type === 'rust') {
				return generateRustSbom(project);
			} else {
				console.error(`Unknown project type: ${project.type}`);
				return Promise.resolve(createEmptyBom());
			}
		})
	);

	console.log('\n=== Merging SBOMs ===\n');

	// Create root dependency node
	const rootDependency: Required<Dependency> = {
		ref: completeBom.metadata.component['bom-ref'],
		dependsOn: []
	};
	completeBom.dependencies.push(rootDependency);

	// Merge each project BOM into the complete BOM
	let depIndex = 1;

	for (let i = 0; i < projectBoms.length; i++) {
		const bom = projectBoms[i];
		const project = allProjects[i];

		console.log(`Merging: ${project.name}`);

		// Find the root component for this project
		const rootComponent = findRootComponent(bom, project.name);
		if (!rootComponent) {
			console.warn(`  ⚠ No root component found for ${project.name}, skipping`);
			continue;
		}

		const bomRef = `${depIndex}-${rootComponent['bom-ref']}`;

		// Add to root dependencies
		rootDependency.dependsOn.push(bomRef);

		// Add project as a component
		const projectComponent: Component = {
			...rootComponent,
			'bom-ref': bomRef,
			name: project.name,
			type: 'application'
		};

		completeBom.components.unshift(projectComponent);

		// Add all components from this project
		if (bom.components?.length) {
			for (const component of bom.components) {
				completeBom.components.push({
					...component,
					'bom-ref': `${depIndex}-${component['bom-ref']}`
				});
			}
			console.log(`  Added ${bom.components.length} components`);
		}

		// Add all dependencies from this project
		if (bom.dependencies?.length) {
			for (const dep of bom.dependencies) {
				const newDep: Dependency = {
					ref: `${depIndex}-${dep.ref}`,
					dependsOn: dep.dependsOn?.map(d => `${depIndex}-${d}`) || []
				};
				completeBom.dependencies.push(newDep);
			}
			console.log(`  Added ${bom.dependencies.length} dependencies`);
		}

		depIndex++;
	}

	// Write the complete SBOM to disk
	const outputPath = resolvePath(__dirname, '../SBOM.json');
	writeFileSync(outputPath, JSON.stringify(completeBom, null, 2));

	console.log('\n=== SBOM Generation Complete ===\n');
	console.log(`Output: ${outputPath}`);
	console.log(`Total components: ${completeBom.components.length}`);
	console.log(`Total dependencies: ${completeBom.dependencies.length}`);
	console.log('');
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
