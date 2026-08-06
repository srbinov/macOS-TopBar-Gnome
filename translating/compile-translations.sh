#!/bin/bash
# Script to compile translation files for Kiwi Menu extension
# This validates and compiles .po files to .mo files with proper error checking.

set -e

EXTENSION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PO_DIR="$EXTENSION_DIR/po"
LOCALE_DIR="$EXTENSION_DIR/locale"

echo "Compiling translations for Kiwi Menu..."
echo "Checking for syntax errors and compiling .po files..."
echo ""

# Check if po directory exists
if [ ! -d "$PO_DIR" ]; then
    echo "✗ Error: po/ directory not found"
    exit 1
fi

# First pass: validate all .po files for syntax errors
VALIDATION_FAILED=0
for po_file in "$PO_DIR"/*.po; do
    if [ ! -f "$po_file" ]; then
        continue
    fi
    
    lang=$(basename "$po_file" .po)
    echo -n "Validating $lang... "
    
    # Use msgfmt with --check to validate without compiling
    if msgfmt --check --verbose "$po_file" -o /dev/null 2>&1; then
        echo "✓"
    else
        echo "✗ FAILED"
        echo ""
        echo "Syntax errors in $po_file:"
        msgfmt --check --verbose "$po_file" -o /dev/null 2>&1 || true
        echo ""
        VALIDATION_FAILED=1
    fi
done

# Exit if validation failed
if [ $VALIDATION_FAILED -eq 1 ]; then
    echo ""
    echo "✗ Translation validation failed. Please fix the errors above."
    exit 1
fi

echo ""
echo "All translations validated successfully!"
echo "Compiling .mo files..."
echo ""

# Second pass: compile all .po files to .mo files
COMPILE_FAILED=0
COMPILED_COUNT=0

for po_file in "$PO_DIR"/*.po; do
    if [ ! -f "$po_file" ]; then
        continue
    fi
    
    lang=$(basename "$po_file" .po)
    output_dir="$LOCALE_DIR/$lang/LC_MESSAGES"
    output_file="$output_dir/kiwimenu@kemma.mo"
    
    # Create output directory
    mkdir -p "$output_dir"
    
    # Compile with statistics
    echo -n "Compiling $lang... "
    if msgfmt --statistics "$po_file" -o "$output_file" 2>&1 | sed 's/^/  /'; then
        COMPILED_COUNT=$((COMPILED_COUNT + 1))
    else
        echo "✗ Failed to compile $lang"
        COMPILE_FAILED=1
    fi
done

echo ""

# Exit if compilation failed
if [ $COMPILE_FAILED -eq 1 ]; then
    echo "✗ Some translations failed to compile."
    exit 1
fi

echo "✓ Successfully compiled $COMPILED_COUNT translations!"
echo "✓ Locale directory: $LOCALE_DIR"
echo ""
echo "Translations are ready for local testing."
echo "To package for distribution, use:"
echo "  gnome-extensions pack --podir=po"
