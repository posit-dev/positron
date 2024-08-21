# Build the iconset for macOS
mkdir positron.iconset
sips -z 16 16   positron.png --out positron.iconset/icon_16x16.png
sips -z 32 32   positron.png --out positron.iconset/icon_16x16@2x.png
sips -z 32 32   positron.png --out positron.iconset/icon_32x32.png
sips -z 64 64   positron.png --out positron.iconset/icon_32x32@2x.png
sips -z 128 128 positron.png --out positron.iconset/icon_128x128.png
sips -z 256 256 positron.png --out positron.iconset/icon_128x128@2x.png
sips -z 256 256 positron.png --out positron.iconset/icon_256x256.png
sips -z 512 512 positron.png --out positron.iconset/icon_256x256@2x.png
sips -z 512 512 positron.png --out positron.iconset/icon_512x512.png
cp positron.png positron.iconset/icon_512x512@2x.png
iconutil -c icns positron.iconset
rm -R positron.iconset
cp positron.png ../resources/darwin/positron.png
cp positron.icns ../resources/darwin/positron.icns

# Copy the product icon to the resources/linux folder.
cp positron.png ../resources/linux/positron.png

# Copy the product icon to the resources/win32 folder.
sips -z 70 70   positron.png --out ../resources/win32/positron_70x70.png
sips -z 150 150 positron.png --out ../resources/win32/positron_150x150.png

# Copy the product icon to the resources/server folder.
sips -z 192 192 positron.png --out ../resources/server/positron-192.png
sips -z 512 512 positron.png --out ../resources/server/positron-512.png

# Copy the product icon for Windows Inno Setup "big" images to the resources/win32 folder.
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

# We resize based on the prior inno setup icons, but need two steps to achieve padded background
convert_png_to_bmp 164 314 164 positron.png ../resources/win32/positron-inno-big-100
convert_png_to_bmp 192 386 192 positron.png ../resources/win32/positron-inno-big-125
convert_png_to_bmp 246 459 246 positron.png ../resources/win32/positron-inno-big-150
convert_png_to_bmp 273 556 273 positron.png ../resources/win32/positron-inno-big-175
convert_png_to_bmp 328 604 328 positron.png ../resources/win32/positron-inno-big-200
convert_png_to_bmp 355 700 355 positron.png ../resources/win32/positron-inno-big-225
convert_png_to_bmp 410 797 410 positron.png ../resources/win32/positron-inno-big-250

convert_png_to_bmp  55  55  55 positron.png ../resources/win32/positron-inno-small-100
convert_png_to_bmp  64  68  64 positron.png ../resources/win32/positron-inno-small-125
convert_png_to_bmp  80  83  80 positron.png ../resources/win32/positron-inno-small-150
convert_png_to_bmp  92  97  92 positron.png ../resources/win32/positron-inno-small-175
convert_png_to_bmp 106 106 110 positron.png ../resources/win32/positron-inno-small-200
convert_png_to_bmp 119 123 119 positron.png ../resources/win32/positron-inno-small-225
convert_png_to_bmp 138 140 138 positron.png ../resources/win32/positron-inno-small-250
