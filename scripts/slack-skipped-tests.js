/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const { execSync } = require('child_process');

const slackSkippedTests = (slackWebhookUrl) => {
	try {
		const skippedTests = execSync(
			'grep -r --include \\*.test.ts -E "describe\\.skip|test\\.skip" test/e2e/tests | sed \'s/\\.test\\.ts.*$/.test.ts/\' || true'
		).toString().trim();

		const softFailedTests = execSync(
			'grep -r --include \\*.test.ts -E "tags\\.SOFT_FAIL" test/e2e/tests | sed \'s/\\.test\\.ts.*$/.test.ts/\' || true'
		).toString().trim();

		const slackMessage = {
			attachments: [
				{
					mrkdwn_in: ['text'],
					color: skippedTests === '' ? '#CCCCCC' : '#FF0000',
					pretext: ':skipping: *Skipped Tests*',
					text: skippedTests === '' ? 'There are no skipped tests. :tada:' : skippedTests,
				},
				{
					mrkdwn_in: ['text'],
					color: softFailedTests === '' ? '#CCCCCC' : 'warning',
					pretext: ':wrenchin: *Soft-Failed Tests*',
					text: softFailedTests === '' ? 'There are no soft-failed tests. :tada:' : softFailedTests,
				},
			],
		};

		console.log('\nskipped tests:')
		console.log(skippedTests);
		console.log('\nsoft failed tests:')
		console.log(softFailedTests);
		console.log('')

		// if no webhook URL is provided, just print the message and exit (most likely a dry run)
		if (!slackWebhookUrl) {
			console.log(slackMessage);
			process.exit(0);
		} else {
			console.log(JSON.stringify(slackMessage, null, 2));
			execSync(
				`curl -X POST -H 'Content-type: application/json' --data '${JSON.stringify(
					slackMessage
				)}' ${slackWebhookUrl}`
			);
		}
	} catch (error) {
		console.error(`Error: ${error}`);
	}
};

slackSkippedTests(process.argv[2]);
