/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');
const { dirs } = require('../build/npm/dirs.js');

// Action file path
const outputPath = path.join(__dirname, '../.github/actions/cache-multi-paths/action.yml');
console.log('output -->', outputPath);

// Template for generating action.yml
const generateActionYaml = (cacheSteps) => `
name: "Cache Multiple Directories"
description: "Restores/Saves cache for node_modules, build, extensions, and remote"
runs:
	using: "composite"
	steps:
${cacheSteps.join('\n')}
`;

// Generate cache steps for each directory that has a yarn.lock file
const generateCacheSteps = (dirs) => {
	return dirs
		.filter((dir) => fs.existsSync(path.join(dir || '.', 'yarn.lock'))) // Ensure the yarn.lock exists for '' as well
		.map((dir) => {
			// Identify if this is the root directory (empty string or '.')
			const isRoot = dir === '' || dir === '.';
			const directory = isRoot ? '.' : dir; // Use '.' for the root directory
			const id = `cache-${isRoot ? 'root' : dir.replace(/[\/\\]/g, '-')}`; // Use 'root' for the root directory's ID
			const nodeModulesPath = isRoot ? './node_modules' : `./${directory}/node_modules`; // Correct path for root

			return `
		- name: Cache '${isRoot ? 'root' : directory}'
			id: ${id}
			uses: actions/cache@v4
			with:
				path: ${nodeModulesPath}
				key: ${id}-v1-\${{ runner.os }}-\${{ hashFiles('${directory}/yarn.lock') }}`;
		});
};

// Create action.yml with dynamically generated steps
const cacheSteps = generateCacheSteps(dirs);
const actionYmlContent = generateActionYaml(cacheSteps);

// Write the generated action.yml content to the file
fs.writeFileSync(outputPath, actionYmlContent, 'utf8');

console.log(`Action file generated at: ${outputPath}`);
