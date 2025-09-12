#!/bin/bash
# Helper script for running Python linting and type checking on Positron-specific code
# Run from extensions/positron-python directory
# Only checks the posit/ directory (Positron-specific code)

set -e

echo "Running Python code quality checks on posit/ directory..."
echo

# Navigate to posit directory where Positron-specific Python code lives
cd python_files/posit

echo "1. Running ruff linter..."
ruff check .
echo "✓ Ruff linting passed"
echo

echo "2. Running ruff format check..."
ruff format --check .
echo "✓ Ruff format check passed"
echo

echo "3. Running pyright type checker on posit directory only..."
pyright positron/
echo "✓ Pyright type checking passed"
echo

echo "All Python quality checks passed successfully for posit/ directory!"