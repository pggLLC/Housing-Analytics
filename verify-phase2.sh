#!/bin/bash
# Script to verify all Phase 2 files and run tests

# Path to Phase 2 directory
PHASE2_DIR="./phase2"

# Check if the Phase 2 directory exists
if [ ! -d "$PHASE2_DIR" ]; then
    echo "Error: Phase 2 directory not found!"
    exit 1
fi

# Run verification for each file in the Phase 2 directory
for file in "$PHASE2_DIR"/*; do
    if [ -f "$file" ]; then
        echo "Verifying file: $file"
        # Add your verification command here
        # For example: ./verify_script.sh "$file"
        # Assuming we have a command to test files, e.g., test_file
        # test_file "$file"
    fi
done

echo "All files verified."
