"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadFileFromS3 = void 0;
// eslint-disable-next-line local/code-import-patterns
const client_s3_1 = require("@aws-sdk/client-s3");
const fs_1 = require("fs");
const stream_1 = require("stream");
const util_1 = require("util");
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * Downloads a file from S3 to the local file system.  Ensure that you locally have an environment variable set like:
 * export AWS_PROFILE='my-dev-profile'
 * where 'my-dev-profile' is the profile name you chose when you ran 'aws configure sso'
 * @param options - S3FileDownloadOptions
 * @returns Promise<void>
 * @throws Error
 **/
const downloadFileFromS3 = async (options) => {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const s3 = new client_s3_1.S3Client({ region: options.region });
            const command = new client_s3_1.GetObjectCommand({
                Bucket: options.bucketName,
                Key: options.key,
            });
            let response = {
                $metadata: {}
            };
            response = await s3.send(command);
            if (!response.Body || !('pipe' in response.Body)) {
                throw new Error('Unexpected response from S3: Body is not a stream');
            }
            const fileStream = (0, fs_1.createWriteStream)(options.localFilePath);
            const streamPipeline = (0, util_1.promisify)(stream_1.pipeline);
            await streamPipeline(response.Body, fileStream);
            // Verify the file was written successfully
            if (!(0, fs_1.existsSync)(options.localFilePath)) {
                throw new Error(`File not found after download: ${options.localFilePath}`);
            }
            const stats = (0, fs_1.statSync)(options.localFilePath);
            if (stats.size === 0) {
                throw new Error(`Downloaded file is empty: ${options.localFilePath}`);
            }
            return;
        }
        catch (error) {
            console.error(`Attempt ${attempt + 1} failed:`, error.message);
            if (attempt === 2) {
                throw error;
            }
            await wait(1000);
        }
    }
};
exports.downloadFileFromS3 = downloadFileFromS3;
//# sourceMappingURL=aws.js.map