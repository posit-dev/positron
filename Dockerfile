# Use a more recent Debian-based Node.js image
FROM node:20-bullseye

# Install system dependencies
RUN apt-get update && apt-get install -y \
    vim curl build-essential clang make cmake git python3-pip python-is-python3 libsodium-dev libxkbfile-dev pkg-config \
    libsecret-1-dev libxss1 dbus xvfb libgtk-3-0 libgbm1 libnss3 libnspr4 libasound2 libkrb5-dev libcairo-dev \
    libsdl-pango-dev libjpeg-dev libgif-dev graphviz \
    && rm -rf /var/lib/apt/lists/*

# Install global dependencies
RUN npm install -g node-gyp npm-run-all

# Set the working directory inside the container
WORKDIR /usr/src/positron

# Copy package.json and yarn.lock (if using) into the container
# COPY package.json yarn.lock ./

# Install Rig and R, along with R packages
RUN curl -Ls https://github.com/r-lib/rig/releases/download/latest/rig-linux-"$(arch)"-latest.tar.gz | tar xz -C /usr/local
RUN rig add 4.4.0
RUN curl https://raw.githubusercontent.com/posit-dev/qa-example-content/main/DESCRIPTION --output DESCRIPTION \
    && Rscript -e "pak::local_install_dev_deps(ask = FALSE)"

# Install Python dependencies
RUN curl https://raw.githubusercontent.com/posit-dev/qa-example-content/main/requirements.txt --output requirements.txt \
    && python3 -m pip install --upgrade pip \
    && python3 -m pip install --no-cache-dir --ignore-installed -r requirements.txt \
    && python3 -m pip install --no-cache-dir --ignore-installed ipykernel trcli

# Copy xvfb init script and set up xvfb
COPY build/azure-pipelines/linux/xvfb.init /etc/init.d/xvfb
RUN chmod +x /etc/init.d/xvfb && update-rc.d xvfb defaults && service xvfb start

# Set required environment variables for running smoke tests
ENV POSITRON_PY_VER_SEL=3.10.12
ENV POSITRON_R_VER_SEL=4.4.0
ENV DISPLAY=:10

# Command to be overridden during runtime
CMD ["sh", "-c", "echo 'Install dependencies and run tests in the CI workflow'"]
