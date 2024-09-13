/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { S3Client, GetObjectCommand, GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';

export type S3FileDownloadOptions = {
	region: string;
	bucketName: string;
	key: string;
	localFilePath: string;
};

/**
 * Downloads a file from S3 to the local file system.  Ensure that you locally have an environment variable set like:
 * export AWS_PROFILE='my-dev-profile'
 * where 'my-dev-profile' is the profile name you chose when you ran 'aws configure sso'
 * @param options - S3FileDownloadOptions
 * @returns Promise<void>
 * @throws Error
 **/
export const downloadFileFromS3 = async (options: S3FileDownloadOptions): Promise<void> => {

	const s3 = new S3Client({ region: options.region });

	const command = new GetObjectCommand({
		Bucket: options.bucketName,
		Key: options.key,
	});

	let response: GetObjectCommandOutput = {
		$metadata: {}
	};
	try {
		response = await s3.send(command);
	} catch (error) {
		console.error('Error:', (error as any).message, (error as any).stack);
	}

	if (!response.Body || !('pipe' in response.Body)) {
		throw new Error('Unexpected response from S3: Body is not a stream');
	}

	const fileStream = createWriteStream(options.localFilePath);
	const streamPipeline = promisify(pipeline);
	await streamPipeline(response.Body, fileStream);

};
