/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Curated map from a Python top-level import name to the PyPI distribution that
 * provides it, for the common cases where the two differ (e.g. `import cv2` ->
 * install `opencv-python`).
 *
 * Why a static map: for a *missing* import we cannot ask the environment for the
 * reverse mapping (`importlib.metadata.packages_distributions()` only knows about
 * installed distributions), and PyPI is not indexed by import name. This map
 * supplies candidate distribution names that the caller then verifies against the
 * package repository before offering, so a stale or wrong entry can only cause a
 * miss, never a suggestion for a package that does not exist.
 *
 * Scope is intentionally narrow: only entries whose import name differs from the
 * distribution name need to be here. Packages that install under the same name
 * (numpy, pandas, scipy, matplotlib, torch, polars, requests, ...) are already
 * resolved by the exact-name search and are deliberately omitted.
 *
 * Seeded from pipreqs' `mapping` file (https://github.com/bndr/pipreqs, Apache
 * License 2.0), trimmed to high-confidence entries and the data-science /
 * scientific-computing packages Positron targets, with stale entries corrected
 * (e.g. `MySQLdb` now maps to `mysqlclient`, not the retired `MySQL-python`).
 *
 * Keys are case-sensitive (Python import names are): `PIL`, not `pil`.
 */
export const IMPORT_TO_DISTRIBUTION: Readonly<Record<string, string>> = {
    // Data science / scientific computing (import name != distribution name).
    cv2: 'opencv-python',
    sklearn: 'scikit-learn',
    skimage: 'scikit-image',
    PIL: 'Pillow',
    Bio: 'biopython',
    osgeo: 'GDAL',
    gdal: 'GDAL',
    mpl_toolkits: 'matplotlib',
    faiss: 'faiss-cpu',
    ibis: 'ibis-framework',

    // Serialization / config / data formats.
    yaml: 'PyYAML',
    ruamel: 'ruamel.yaml',
    dateutil: 'python-dateutil',
    dotenv: 'python-dotenv',
    slugify: 'python-slugify',

    // Documents / files / media.
    docx: 'python-docx',
    pptx: 'python-pptx',
    fitz: 'PyMuPDF',
    magic: 'python-magic',

    // Web / scraping / networking.
    bs4: 'beautifulsoup4',
    grpc: 'grpcio',
    zmq: 'pyzmq',
    dns: 'dnspython',
    googleapiclient: 'google-api-python-client',
    speech_recognition: 'SpeechRecognition',
    discord: 'discord.py',
    telegram: 'python-telegram-bot',

    // Security / crypto / auth.
    Crypto: 'pycryptodome',
    Cryptodome: 'pycryptodomex',
    OpenSSL: 'pyOpenSSL',
    nacl: 'PyNaCl',
    jwt: 'PyJWT',

    // Databases.
    MySQLdb: 'mysqlclient',
    bson: 'pymongo',
    gridfs: 'pymongo',

    // Hardware / system / GUI / native bindings.
    serial: 'pyserial',
    usb: 'pyusb',
    OpenGL: 'PyOpenGL',
    cairo: 'pycairo',
    gi: 'PyGObject',
    wx: 'wxPython',
    Levenshtein: 'python-Levenshtein',

    // Windows-only (all provided by pywin32).
    win32api: 'pywin32',
    win32com: 'pywin32',
    win32con: 'pywin32',
    win32file: 'pywin32',
    win32gui: 'pywin32',
    pythoncom: 'pywin32',
    pywintypes: 'pywin32',

    // Packaging / tooling.
    pkg_resources: 'setuptools',
    attr: 'attrs',
};
