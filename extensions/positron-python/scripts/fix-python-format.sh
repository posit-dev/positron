#!/bin/bash
# Helper script for fixing Python formatting and safe linting issues in Positron-specific code
# Run from extensions/positron-python directory
# Only formats the posit/ directory (Positron-specific code)

set -e

echo "Fixing Python code formatting and linting issues in posit/ directory..."
echo

# Navigate to posit directory where Positron-specific Python code lives
cd python_files/posit

echo "1. Running ruff format..."
ruff format .
echo "✓ Ruff formatting applied"
echo

echo "2. Running ruff check with --fix for safe fixes..."
ruff check --fix .
echo "✓ Ruff safe fixes applied"
echo

echo "3. Running final check to show any remaining issues..."
echo
ruff check .

echo
echo "Formatting and safe fixes complete for posit/ directory!"
echo "Run ./scripts/check-python-quality.sh to verify all checks pass."