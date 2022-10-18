mkdir positron.iconset
sips -z 16 16     positron-icon.png --out positron.iconset/icon_16x16.png
sips -z 32 32     positron-icon.png --out positron.iconset/icon_16x16@2x.png
sips -z 32 32     positron-icon.png --out positron.iconset/icon_32x32.png
sips -z 64 64     positron-icon.png --out positron.iconset/icon_32x32@2x.png
sips -z 128 128   positron-icon.png --out positron.iconset/icon_128x128.png
sips -z 256 256   positron-icon.png --out positron.iconset/icon_128x128@2x.png
sips -z 256 256   positron-icon.png --out positron.iconset/icon_256x256.png
sips -z 512 512   positron-icon.png --out positron.iconset/icon_256x256@2x.png
sips -z 512 512   positron-icon.png --out positron.iconset/icon_512x512.png
cp positron-icon.png positron.iconset/icon_512x512@2x.png
iconutil -c icns positron.iconset
rm -R positron.iconset
