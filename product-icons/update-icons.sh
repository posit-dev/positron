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

# Copy the product icon to the resources/win32 folder.
sips -z 192 192 positron.png --out ../resources/server/positron-192.png
sips -z 512 512 positron.png --out ../resources/server/positron-512.png
