#!/bin/bash

# start-vnc.sh - Starts VNC server based on detected OS
# Run this inside the container to enable VNC access on port 5900

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        echo "$ID"
    else
        echo "unknown"
    fi
}

OS=$(detect_os)

echo "Detected OS: $OS"
echo "Starting VNC server..."

case "$OS" in
    ubuntu|debian)
        fluxbox &
        sudo x11vnc -forever -nopw -display :10 &
        ;;
    rocky|rhel|centos)
        x0vncserver -display :10 -SecurityTypes None -rfbport 5900 -AlwaysShared &
        ;;
    opensuse*|sles)
        # SLES may need x11vnc installed first
        if ! command -v x11vnc &> /dev/null; then
            echo "Installing x11vnc..."
            export PATH=/usr/bin:/bin:$PATH
            zypper refresh
            zypper install -y x11vnc
        fi
        DISPLAY=:10 fluxbox &
        x11vnc -display :10 -forever -nopw -shared -rfbport 5900 &
        ;;
    *)
        echo "Unknown OS: $OS"
        echo "Trying generic x11vnc approach..."
        x11vnc -display :10 -forever -nopw -shared -rfbport 5900 &
        ;;
esac

echo ""
echo "VNC server started on port 5900"
echo "Connect with a VNC viewer to localhost:5900 on your host machine"
echo "(RealVNC Viewer is a good free option)"
