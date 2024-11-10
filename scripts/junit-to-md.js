/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Try to require xml2js, install if not present
let xml2js;
try {
	xml2js = require('xml2js');
} catch (e) {
	console.log('xml2js not found, installing...');
	execSync('npm install xml2js --legacy-peer-deps', { stdio: 'inherit' });
	xml2js = require('xml2js');
}

const parser = new xml2js.Parser();

// Get the input file path from the command line arguments, or default to './junit.xml'
const inputFile = process.argv[2] || './junit.xml';
const outputFile = process.argv[3] || './test-summary.md';

fs.readFile(inputFile, (err, data) => {
	if (err) {
		console.error(`Error reading file ${inputFile}:`, err);
		return;
	}
	parser.parseString(data, (err, result) => {
		if (err) {
			console.error('Error parsing XML:', err);
			return;
		}
		const markdown = generateMarkdown(result);
		fs.writeFileSync(outputFile, markdown);

		// If running in GitHub Actions, publish to summary
		if (process.env.GITHUB_STEP_SUMMARY) {
			fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
			console.log('markdown appended to GitHub Actions step summary');
		}
	});
});

function generateMarkdown(junitJson) {
	let totalTests = 0;
	let passedTests = 0;
	let failedTests = 0;
	let skippedTests = 0;
	let markdown = '';

	// Count tests in each suite
	junitJson.testsuites.testsuite.forEach((suite) => {
		suite.testcase.forEach((test) => {
			totalTests++;
			if (test.failure) {
				failedTests++;
			} else if (test.skipped) {
				skippedTests++;
			} else {
				passedTests++;
			}
		});
	});

	// Summary section with non-zero values
	let summary = `🧪 Total: ${totalTests}`;
	if (passedTests > 0) { summary += ` &nbsp;|&nbsp; ✅ Pass: ${passedTests}`; }
	if (failedTests > 0) { summary += ` &nbsp;|&nbsp; ❌ Fail: ${failedTests}`; }
	if (skippedTests > 0) { summary += ` &nbsp;|&nbsp; ⏭️ Skip: ${skippedTests}`; }
	markdown += summary + '\n\n';

	// Formatting for each suite
	junitJson.testsuites.testsuite.forEach((suite) => {
		let suiteMarkdown = `<details><summary>❌ ${suite.$.name}</summary>\n<table role='table'>\n<thead>\n<tr>\n<th>Test</th><th>Status</th><th>Duration</th><th>Error</th>\n</tr>\n</thead>\n<tbody>\n`;
		let hasFailures = false;

		suite.testcase.forEach((test) => {
			const testName = test.$.name;
			const duration = parseFloat(test.$.time).toFixed(3) + 's';
			let status = '';
			let error = '';

			// Include only failed tests in the details section
			if (test.failure) {
				hasFailures = true;
				status = '❌ Fail';

				// Extract the error text
				const rawError = test.failure[0]._ || 'Error details not available';
				const errorMessage = rawError;

				// Determine the first line of the error based on conditions
				let firstLine;
				if (/Test timeout of \d+ms exceeded/.test(rawError)) {
					firstLine = 'Test timeout';
				} else if (rawError.includes('Error:')) {
					firstLine = rawError.split('Error:')[1].split('\n')[0].trim();
				} else {
					firstLine = 'Expand to view more...';
				}

				// Create a collapsible <details> for the full error message
				error = `<details><summary>${firstLine}</summary><pre>${errorMessage}</pre></details>`;

				// Add row for failed tests only
				suiteMarkdown += `<tr>\n<td>${testName}</td><td>${status}</td><td>${duration}</td><td>${error}</td>\n</tr>\n`;
			}
		});

		// Close tags if suite has failures
		if (hasFailures) {
			suiteMarkdown += '</tbody>\n</table></details>\n';
			markdown += suiteMarkdown;
		}
	});
	console.log(`markdown output: ${path.resolve(outputFile)}`);
	return markdown;
}
