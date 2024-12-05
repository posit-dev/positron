/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const { execSync } = require('child_process');

const slackSkippedTests = (slackWebhookUrl) => {
	try {
		const skippedTests = execSync(
			`grep -r --include \\*.test.ts -E "describe\\.skip|test\\.skip" test/e2e/features | sed 's/\\.test\\.ts.*$/.test.ts/'`
		).toString();

		const slackMessage = {
			attachments: [
				{
					mrkdwn_in: ['text'],
					color: skippedTests === '' ? '#CCCCCC' : '#FF0000',
					pretext: ':skipping:*Skipped Tests*',
					text: skippedTests === '' ? 'There are no skipped tests. :tada:' : skippedTests,
				},
			],
		};

		console.log(skippedTests);
		console.log(JSON.stringify(slackMessage, null, 2));

		execSync(
			`curl -X POST -H 'Content-type: application/json' --data '${JSON.stringify(
				slackMessage
			)}' ${slackWebhookUrl}`
		);
	} catch (error) {
		console.error(`Error: ${error}`);
	}
};

slackSkippedTests(process.argv[2]);
