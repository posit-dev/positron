/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Complete build script for @posit-dev/positron package
 *
 * This script handles the entire build process from source gathering to final package generation.
 * It combines what were previously separate "gather" and "compile" steps into a single workflow.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Centralize paths to prevent duplication and make maintenance easier
const PATHS = {
	SOURCE_DIR: path.join(__dirname, '../src/positron-dts'),
	PACKAGE_SRC: path.join(__dirname, 'src'),
	DIST_DIR: path.join(__dirname, 'dist')
};

// Centralize filenames to avoid typos and enable easy renaming
const FILES = {
	POSITRON_DTS: 'positron.d.ts',
	UI_COMM_DTS: 'ui-comm.d.ts',
	INDEX_DTS: 'index.d.ts'
};

console.log('🔨 Building @posit-dev/positron package...\n');

// =============================================================================
// PREREQUISITE VALIDATION
// =============================================================================
// Early validation prevents confusing error messages later in the build process

console.log('🔍 Validating prerequisites...');

const sourceFile = path.join(PATHS.SOURCE_DIR, FILES.POSITRON_DTS);
const uiCommFile = path.join(PATHS.SOURCE_DIR, FILES.UI_COMM_DTS);

if (!fs.existsSync(sourceFile)) {
	console.error(`   ❌ Source file not found: ${sourceFile}`);
	process.exit(1);
}

if (!fs.existsSync(uiCommFile)) {
	console.error(`   ❌ Source file not found: ${uiCommFile}`);
	process.exit(1);
}

// Fail fast if TypeScript isn't available rather than during compilation
try {
	execSync('tsc --version', { stdio: 'pipe' });
} catch (error) {
	console.error('   ❌ TypeScript compiler not found. Please install TypeScript globally or in this project.');
	process.exit(1);
}

// Verify we're in the correct working directory
const packageJsonPath = path.join(__dirname, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
	console.error('   ❌ package.json not found. Are you running this script from the correct directory?');
	process.exit(1);
}

console.log('   ✅ All prerequisites validated');

// =============================================================================
// STEP 1: GATHER TYPE DEFINITIONS FROM MAIN POSITRON SOURCE
// =============================================================================
// Copy ambient module declarations from the main Positron repository.
// These .d.ts files contain 'declare module' statements that register the
// 'positron' and 'ui-comm' modules in TypeScript's module system, making
// them available for import in consumer code.

console.log('📥 Step 1: Gathering type definitions from Positron source...');

// Create src directory if missing to avoid copy failures
if (!fs.existsSync(PATHS.PACKAGE_SRC)) {
	try {
		fs.mkdirSync(PATHS.PACKAGE_SRC, { recursive: true });
	} catch (error) {
		console.error(`   ❌ Failed to create package source directory: ${error.message}`);
		process.exit(1);
	}
}

// Copy source files with error handling to catch permission or disk space issues
try {
	fs.copyFileSync(sourceFile, path.join(PATHS.PACKAGE_SRC, FILES.POSITRON_DTS));
	fs.copyFileSync(uiCommFile, path.join(PATHS.PACKAGE_SRC, FILES.UI_COMM_DTS));
	console.log('   ✅ Type definitions copied to package source directory');
} catch (error) {
	console.error(`   ❌ Failed to copy type definitions: ${error.message}`);
	process.exit(1);
}

// =============================================================================
// STEP 2: COMPILE TYPESCRIPT SOURCE CODE
// =============================================================================
// Run the TypeScript compiler to transform our TypeScript source files into
// JavaScript (.js) and declaration files (.d.ts). This generates the main
// package entry point that consumers will actually use.

console.log('\n🔧 Step 2: Compiling TypeScript source code...');

try {
	execSync('tsc --project tsconfig.json', { stdio: 'inherit', cwd: __dirname });
	console.log('   ✅ TypeScript compilation completed');
} catch (error) {
	console.error('   ❌ TypeScript compilation failed');
	process.exit(1);
}

// =============================================================================
// STEP 3: COPY AMBIENT DECLARATIONS TO DISTRIBUTION
// =============================================================================
// Copy the ambient module declarations from src/ to dist/ so they're included
// in the published package. These files must be distributed alongside the
// compiled code to make the 'positron' and 'ui-comm' namespaces available
// to package consumers.

console.log('\n📦 Step 3: Copying ambient module declarations to distribution...');

// Copy files with error handling since dist operations can fail due to permissions
try {
	fs.copyFileSync(path.join(PATHS.PACKAGE_SRC, FILES.POSITRON_DTS), path.join(PATHS.DIST_DIR, FILES.POSITRON_DTS));
	fs.copyFileSync(path.join(PATHS.PACKAGE_SRC, FILES.UI_COMM_DTS), path.join(PATHS.DIST_DIR, FILES.UI_COMM_DTS));
	console.log('   ✅ Ambient declarations copied to dist/');
} catch (error) {
	console.error(`   ❌ Failed to copy ambient declarations: ${error.message}`);
	process.exit(1);
}

// =============================================================================
// STEP 4: ADD REFERENCE DIRECTIVES TO MAIN DECLARATION FILE
// =============================================================================
// Modify the compiled index.d.ts file to include reference directives that
// point to our ambient module declarations. This ensures TypeScript can
// properly resolve the 'positron' and 'ui-comm' modules when consumers
// import this package.

console.log('\n🔗 Step 4: Adding reference directives to main declaration file...');

const indexFile = path.join(PATHS.DIST_DIR, FILES.INDEX_DTS);

// Handle file operations with error checking since file corruption here breaks the entire package
try {
	const content = fs.readFileSync(indexFile, 'utf8');
	const references = [
		`/// <reference path="./${FILES.POSITRON_DTS}" />`,
		`/// <reference path="./${FILES.UI_COMM_DTS}" />`,
		'',
		content
	].join('\n');

	fs.writeFileSync(indexFile, references);
	console.log('   ✅ Reference directives added to index.d.ts');
} catch (error) {
	console.error(`   ❌ Failed to add reference directives: ${error.message}`);
	process.exit(1);
}

// =============================================================================
// STEP 5: VALIDATE BUILT PACKAGE
// =============================================================================
// Test that the built package can actually be imported and used. This ensures
// that all the compilation and file operations resulted in a working package
// that exports the expected functionality.

console.log('\n🔍 Step 5: Validating built package...');

try {
	// Test that the built package can be required (CommonJS output)
	const builtPackage = require(path.join(PATHS.DIST_DIR, 'index.js'));
	
	// Verify the main export exists
	if (typeof builtPackage.getPositronApi !== 'function') {
		throw new Error('getPositronApi function not exported');
	}
	
	// Test that the function returns undefined in this environment (expected behavior)
	const api = builtPackage.getPositronApi();
	if (api !== undefined) {
		throw new Error('getPositronApi should return undefined in build environment');
	}
	
	console.log('   ✅ Package validation passed');
	console.log('   ✅ getPositronApi function is properly exported');
	console.log('   ✅ Function correctly returns undefined in non-Positron environment');
} catch (error) {
	console.error(`   ❌ Package validation failed: ${error.message}`);
	process.exit(1);
}

// =============================================================================
// BUILD COMPLETE
// =============================================================================

console.log('\n🎉 Build completed successfully!');
console.log('\n📋 Generated files:');
console.log('   • dist/index.js     - Runtime API detection function');
console.log('   • dist/index.d.ts   - Main TypeScript definitions');
console.log('   • dist/positron.d.ts - Ambient \'positron\' module declarations');
console.log('   • dist/ui-comm.d.ts  - Ambient \'ui-comm\' module declarations');
console.log('\n🚀 Package is ready for publishing or consumption!');
