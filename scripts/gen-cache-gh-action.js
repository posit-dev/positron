/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');
const { dirs } = require('../build/npm/dirs.js');

// Path to write the generated action.yml file
const outputPath = path.join(__dirname, '../.github/actions/cache-multi-paths/action.yml');

// Template for generating action.yml
const generateActionYaml = (cacheSteps) => `
name: "Cache Multiple Directories"
description: "Restores/Saves cache for node_modules, build, extensions, etc"
runs:
	using: "composite"
	steps:
${cacheSteps.join('\n')}
${generateCheckAllCachesStep(cacheSteps)}
`;

// Helper function to generate a valid GitHub action ID
const generateId = (dir) => {
	if (!dir || dir === '.') { return 'cache-root'; } // Handle root directory as 'cache-root'
	// Replace invalid characters and ensure it starts with a letter or underscore
	const sanitized = dir.replace(/[^\w-]/g, '-'); // Replace all non-alphanumeric and non-dash characters with '-'
	return `cache-${sanitized}`;
};

// Generate cache steps for each directory that has a yarn.lock file
const generateCacheSteps = (dirs) => {
	return dirs
		.filter((dir) => fs.existsSync(path.join(dir || '.', 'yarn.lock')))  // Ensure the yarn.lock exists for '' as well
		.map((dir) => {
			// Identify if this is the root directory (empty string or '.')
			const isRoot = dir === '' || dir === '.';
			const directory = isRoot ? '.' : dir; // Use '.' for the root directory
			const id = generateId(dir); // Use the helper function to generate a valid ID
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

// Generate the "Check All Caches" step dynamically based on cache step IDs
const generateCheckAllCachesStep = (cacheSteps) => {
	const cacheIds = cacheSteps.map((step) => {
		const match = step.match(/id:\s+(cache-[\w-]+)/);
		return match ? match[1] : null;
	}).filter(Boolean);

	const hitCheckVariables = cacheIds.map((id) => `        ${id.toUpperCase().replace(/-/g, '_')}_HIT=\${{ steps.${id}.outputs.cache-hit == 'true' }}`).join('\n');
	const allHitCheck = cacheIds.map((id) => `\${{ steps.${id}.outputs.cache-hit == 'true' }}`).join(' && ');

	return `
	  - name: Check All Caches
      shell: bash
      id: check-all-caches
      run: |
	      # Check cache-hit status for each cache step
${hitCheckVariables}

        # Calculate if all caches were a hit
        if [ ${allHitCheck} ]; then
          echo "All caches hit: true"
          echo "::set-output name=all-hit::true"
        else
          echo "All caches hit: false"
          echo "::set-output name=all-hit::false"
        fi
  `;
};

// Create action.yml with dynamically generated steps
const cacheSteps = generateCacheSteps(dirs);
let actionYmlContent = generateActionYaml(cacheSteps);

// Replace any tabs with 2 spaces to ensure proper YAML formatting
actionYmlContent = actionYmlContent.replace(/\t/g, '  ');

// Write the generated action.yml content to the file
fs.writeFileSync(outputPath, actionYmlContent, 'utf8');

console.log(`Action file generated at: ${outputPath}`);
