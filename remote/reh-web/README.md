# reh-web

> [!IMPORTANT]
> **Please don't edit files in this directory directly.**

The [package.json](./package.json) file in this directory is a merge of the [remote/package.json](../package.json) file and the [remote/web/package.json](../web/package.json) file, as the packages needed to build reh-web are a combination of the remote and web packages.

The package.json file in this directory is created/updated via the [build/npm/postinstall.js](../../build/npm/postinstall.js) script. That script is automatically run before `yarn install` is executed (at which point the yarn.lock and node_modules directories are created/updated in this directory).

> [!NOTE]
> Please commit the created/updated package.json and yarn.lock files in this directory when they are updated.
