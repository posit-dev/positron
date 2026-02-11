import * as path from 'path';

export const ENVS_EXTENSION_ID = 'ms-python.vscode-python-envs';
export const PYTHON_EXTENSION_ID = 'ms-python.python';
export const JUPYTER_EXTENSION_ID = 'ms-toolsai.jupyter';
export const EXTENSION_ROOT_DIR = path.dirname(__dirname);

export const DEFAULT_PACKAGE_MANAGER_ID = 'ms-python.python:pip';
export const DEFAULT_ENV_MANAGER_ID = 'ms-python.python:venv';

export const KNOWN_FILES = [
    'requirements.txt',
    'requirements.in',
    '.condarc',
    '.python-version',
    'environment.yml',
    'pyproject.toml',
    'meta.yaml',
    '.flake8',
    '.pep8',
    '.pylintrc',
    '.pypirc',
    'Pipfile',
    'poetry.lock',
    'Pipfile.lock',
];

export const KNOWN_TEMPLATE_ENDINGS = ['.j2', '.jinja2'];

export const NEW_PROJECT_TEMPLATES_FOLDER = path.join(EXTENSION_ROOT_DIR, 'files', 'templates');
export const NotebookCellScheme = 'vscode-notebook-cell';
