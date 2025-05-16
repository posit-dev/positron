/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('R Debugging', {
	tag: [tags.DEBUG, tags.WEB, tags.WIN]
}, () => {

	test('R - Verify manual break point and debugging with browser()', async function ({ page, sessions, executeCode }) {
		await sessions.start(['r']);
		await executeCode('R', script);

		// Call the function and hit the breakpoint
		await executeCode('R', 'fruit_avg(dat, "berry")', { waitForReady: false });
		await expect(page.getByText('Browse[1]>')).toBeVisible();

		// Verify debug variables section is visible
		await expect(page.getByRole('button', { name: 'Debug Variables Section' })).toBeVisible();
		await expect(page.getByLabel('pattern, value "berry"')).toBeVisible();
		await expect(page.getByLabel('dat, value dat')).toBeVisible();

		// Verify the call stack section is visible
		await expect(page.getByRole('button', { name: 'Call Stack Section' })).toBeVisible();
		const debugCallStack = page.locator('.debug-call-stack');
		await expect(debugCallStack.getByText('fruit_avg()fruit_avg()2:')).toBeVisible();
		await expect(debugCallStack.getByText('<global>fruit_avg(dat, "berry")')).toBeVisible();

		// Inspect the pattern variable
		await page.keyboard.type('pattern');
		await page.keyboard.press('Enter');
		await expect(page.getByText('[1] "berry"')).toBeVisible();

		// Inspect the structure of dat
		await page.keyboard.type('names(dat)');
		await page.keyboard.press('Enter');
		await expect(page.getByText('[1] "blackberry" "blueberry"  "peach" "plum"')).toBeVisible({ timeout: 30000 });

		// Step to the next line with 'n'
		await page.keyboard.type('n');
		await page.keyboard.press('Enter');
		await expect(page.getByText('debug at #3: cols <- grep(pattern, names(dat))')).toBeVisible();

		// Finally, continue
		await page.keyboard.type('c');
		await page.keyboard.press('Enter');

		// Confirm expected message appears
		await expect(page.getByText('Found 2 fruits!')).toBeVisible();
	});
});


const script = `dat <- data.frame(
blackberry = c(4, 9, 6),
blueberry = c(1, 2, 8),
peach = c(59, 150, 10),
plum = c(30, 78, 5)
)
rownames(dat) <- c("calories", "weight", "yumminess")

fruit_avg <- function(dat, pattern) {
browser()
cols <- grep(pattern, names(dat))
mini_dat <- dat[ , cols]
message("Found ", ncol(mini_dat), " fruits!")
rowMeans(mini_dat)
}`;
