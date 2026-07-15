FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies including systemd
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    systemd \
    systemd-sysv \
    ca-certificates \
    curl \
    wget \
    git \
    sudo \
    vim \
    jq \
    libsecret-1-0 \
    libkrb5-3 \
    python3 \
    python3-pip \
    python3-venv \
    python-is-python3 \
    openssh-server \
    acl \
    && rm -rf /var/lib/apt/lists/*

# Clean up systemd
RUN cd /lib/systemd/system/sysinit.target.wants/ && \
    ls | grep -v systemd-tmpfiles-setup | xargs rm -f && \
    rm -f /lib/systemd/system/multi-user.target.wants/* \
    /etc/systemd/system/*.wants/* \
    /lib/systemd/system/local-fs.target.wants/* \
    /lib/systemd/system/sockets.target.wants/*udev* \
    /lib/systemd/system/sockets.target.wants/*initctl* \
    /lib/systemd/system/basic.target.wants/* \
    /lib/systemd/system/anaconda.target.wants/* \
    /lib/systemd/system/plymouth* \
    /lib/systemd/system/systemd-update-utmp*

# Enable systemd
STOPSIGNAL SIGRTMIN+3

# TLJH will create users as needed

# Set up working directory
WORKDIR /opt

# Use systemd as init
CMD ["/lib/systemd/systemd"]
