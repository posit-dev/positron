#!/bin/bash

# Publish script for @posit-dev/positron-types
# This script handles versioning, building, and publishing the package

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$SCRIPT_DIR"

echo -e "${BLUE}🚀 Publishing @posit-dev/positron${NC}"
echo "========================================"

# Check if we're in a git repository and on the right branch
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Not in a git repository${NC}"
    exit 1
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
    if [[ "$NON_INTERACTIVE" == "false" ]]; then
        read -p "Do you want to continue? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${RED}❌ Aborted${NC}"
            exit 1
        fi
    else
        echo -e "${BLUE}🤖 Non-interactive mode: continuing with uncommitted changes${NC}"
    fi
fi

# Change to package directory
cd "$PACKAGE_DIR"

# Parse command line arguments
VERSION_TYPE=""
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --non-interactive|-y)
            NON_INTERACTIVE=true
            shift
            ;;
        patch|minor|major|prerelease)
            if [[ -z "$VERSION_TYPE" ]]; then
                VERSION_TYPE="$1"
            else
                echo -e "${RED}❌ Error: Multiple version types specified${NC}"
                exit 1
            fi
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [patch|minor|major|prerelease] [--non-interactive|-y]"
            echo ""
            echo "Arguments:"
            echo "  patch|minor|major|prerelease  Version bump type (default: patch)"
            echo ""
            echo "Options:"
            echo "  --non-interactive, -y         Skip confirmation prompts"
            echo "  --help, -h                   Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Error: Unknown argument '$1'${NC}"
            echo "Usage: $0 [patch|minor|major|prerelease] [--non-interactive|-y]"
            exit 1
            ;;
    esac
done

# Set default version type if not specified
VERSION_TYPE="${VERSION_TYPE:-patch}"

if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major|prerelease)$ ]]; then
    echo -e "${RED}❌ Error: Invalid version type '$VERSION_TYPE'${NC}"
    echo "Usage: $0 [patch|minor|major|prerelease] [--non-interactive|-y]"
    exit 1
fi

echo -e "${BLUE}📋 Pre-publish checklist:${NC}"

# Step 1: Build the package (includes type generation)
echo -e "${BLUE}1. Building package...${NC}"
cd "$PACKAGE_DIR"
npm run build
if [[ $? -ne 0 ]]; then
    echo -e "${RED}❌ Failed to build package${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Package built successfully${NC}"

# Step 2: Show current version and ask for confirmation
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${BLUE}2. Current version: ${YELLOW}v$CURRENT_VERSION${NC}"

# Calculate what the new version will be
echo -e "${BLUE}   Bumping $VERSION_TYPE version...${NC}"

# Step 3: Version bump
echo -e "${BLUE}3. Updating version...${NC}"
npm version "$VERSION_TYPE" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}✅ Version updated to v$NEW_VERSION${NC}"

# Step 4: Final confirmation
echo -e "${YELLOW}📦 Ready to publish v$NEW_VERSION${NC}"
if [[ "$NON_INTERACTIVE" == "false" ]]; then
    read -p "Do you want to publish to npm? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}⚠️  Version was updated but not published${NC}"
        echo -e "${BLUE}💡 To publish later, run: npm publish${NC}"
        exit 0
    fi
else
    echo -e "${BLUE}🤖 Non-interactive mode: proceeding with publish${NC}"
fi

# Step 5: Publish to npm
echo -e "${BLUE}5. Publishing to npm...${NC}"
npm publish

if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}🎉 Successfully published @posit-dev/positron@$NEW_VERSION${NC}"
    echo -e "${BLUE}💡 Remember to commit and push!${NC}"
else
    echo -e "${RED}❌ Failed to publish to npm${NC}"
    exit 1
fi

echo
echo -e "${GREEN}🎊 All done! Package published successfully.${NC}"
echo -e "${BLUE}📦 Install with: npm install --save-dev @posit-dev/positron${NC}"
