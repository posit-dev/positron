#!/bin/bash

# Ensure the script is called with an argument
if [ -z "$1" ]; then
    echo "Usage: $0 <icon-file>"
    exit 1
fi

# Use the provided argument as Positron flavor
POSITRON="$1"

# Build the iconset for macOS
mkdir ${POSITRON}.iconset
sips -z 16 16   "${POSITRON}.png" --out ${POSITRON}.iconset/icon_16x16.png
sips -z 32 32   "${POSITRON}.png" --out ${POSITRON}.iconset/icon_16x16@2x.png
sips -z 32 32   "${POSITRON}.png" --out ${POSITRON}.iconset/icon_32x32.png
sips -z 64 64   "${POSITRON}.png" --out ${POSITRON}.iconset/icon_32x32@2x.png
sips -z 128 128 "${POSITRON}.png" --out ${POSITRON}.iconset/icon_128x128.png
sips -z 256 256 "${POSITRON}.png" --out ${POSITRON}.iconset/icon_128x128@2x.png
sips -z 256 256 "${POSITRON}.png" --out ${POSITRON}.iconset/icon_256x256.png
sips -z 512 512 "${POSITRON}.png" --out ${POSITRON}.iconset/icon_256x256@2x.png
sips -z 512 512 "${POSITRON}.png" --out ${POSITRON}.iconset/icon_512x512.png
cp "${POSITRON}.png" ${POSITRON}.iconset/icon_512x512@2x.png
iconutil -c icns ${POSITRON}.iconset
rm -R ${POSITRON}.iconset
cp "${POSITRON}.png" ../resources/darwin/${POSITRON}.png
cp ${POSITRON}.icns ../resources/darwin/${POSITRON}.icns

# Copy the product icon to the resources/linux folder.
cp "${POSITRON}.png" ../resources/linux/${POSITRON}.png

# Copy the product icon to the resources/win32 folder.
sips -z 70 70   "${POSITRON}.png" --out ../resources/win32/${POSITRON}_70x70.png
sips -z 150 150 "${POSITRON}.png" --out ../resources/win32/${POSITRON}_150x150.png

# Copy the product icon to the resources/server folder.
sips -z 192 192 "${POSITRON}.png" --out ../resources/server/${POSITRON}-192.png
sips -z 512 512 "${POSITRON}.png" --out ../resources/server/${POSITRON}-512.png

# Functions for Windows Inno Setup installer
constrain_image() {
    local max=$1
    local input=$2
    local output=$3
    sips -Z "$max" -s dpiHeight 96 -s dpiWidth 96 --padColor FFFFFF "$input" --out "$output"
}

pad_image() {
    local height=$1
    local width=$2
    local input=$3
    local output=$4
    sips -p "$height" "$width" --padColor FFFFFF "$input" --out "$output"
}

to_bmp() {
    local input=$1
    local output=$2
    sips -s format bmp "$input" --out "$output"
}

convert_png_to_bmp() {
    local max=$1
    local height=$2
    local width=$3
    local input=$4
    local output_base=$5
    local output_png="${output_base}.png"
    local output_bmp="${output_base}.bmp"
    constrain_image "$max" "$input" "$output_png"
    pad_image "$height" "$width" "$output_png" "$output_png"
    to_bmp "$output_png" "$output_bmp"
    rm -f "$output_png"
}

convert_png_to_bmp 164 314 164 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-big-100
convert_png_to_bmp 192 386 192 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-big-125
convert_png_to_bmp 246 459 246 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-big-150
convert_png_to_bmp 273 556 273 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-big-175
convert_png_to_bmp 328 604 328 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-big-200
convert_png_to_bmp 355 700 355 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-big-225
convert_png_to_bmp 410 797 410 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-big-250

convert_png_to_bmp  55  55  55 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-small-100
convert_png_to_bmp  64  68  64 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-small-125
convert_png_to_bmp  80  83  80 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-small-150
convert_png_to_bmp  92  97  92 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-small-175
convert_png_to_bmp 106 106 110 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-small-200
convert_png_to_bmp 119 123 119 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-small-225
convert_png_to_bmp 138 140 138 "${POSITRON}.png" ../resources/win32/${POSITRON}-inno-small-250
