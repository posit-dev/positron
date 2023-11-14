/**
 * Information about a test state as outputted by R reporter, in JSON format.
 */
export interface TestResult {
	type:
	| 'start_reporter'
	| 'start_file'
	| 'start_test'
	| 'add_result'
	| 'end_test'
	| 'end_file'
	| 'end_reporter';
	/**
	 * Relative path of the test file if available
	 */
	filename?: string;
	/**
	 * Test label if available
	 */
	test?: string;
	/**
	 * Test result if available
	 */
	result?: 'success' | 'failure' | 'error' | 'skip' | 'warning';
	/**
	 * This message will be displayed by the Test Explorer when the user selects the test.
	 * It is usually used for information about why a test has failed.
	 */
	message?: string;
}
