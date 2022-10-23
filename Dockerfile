FROM ubuntu:20.04
ENV IS_DOCKER true

# Replace shell with bash so we can source files
RUN rm /bin/sh && ln -s /bin/bash /bin/sh

# Set debconf to run non-interactively
RUN echo 'debconf debconf/frontend select Noninteractive' | debconf-set-selections

# Install base dependencies
RUN apt-get update && apt-get install --yes -q --no-install-recommends \
  apt-transport-https \
  build-essential \
  ca-certificates \
  curl \
  git \
  wget \
  libssl-dev \
  openssl \
  libz-dev \
  zlib1g-dev \
  libbz2-dev \
  libreadline-dev \
  libsqlite3-dev \
  llvm \
  libncurses5-dev \
  xz-utils \
  tk-dev libxml2-dev \
  libxmlsec1-dev \
  libffi-dev \
  liblzma-dev \
  libgdbm-dev \
  libnss3-dev \
  libc6-dev

# Run the container as an unprivileged user
RUN groupadd docker && useradd -g docker -s /bin/bash -m docker
USER docker
WORKDIR /home/docker

# Install Node.js with nvm
ENV NVM_DIR /home/docker/.nvm
ENV NODE_VERSION v16.18.0

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.2/install.sh | bash
RUN /bin/bash -c "source $NVM_DIR/nvm.sh && nvm install $NODE_VERSION && nvm use --delete-prefix $NODE_VERSION"

ENV NODE_PATH $NVM_DIR/versions/node/$NODE_VERSION/lib/node_modules
ENV PATH $NVM_DIR/versions/node/$NODE_VERSION/bin:$PATH

# Install Leon
WORKDIR /home/docker/leon
USER root
RUN chown -R docker /home/docker/leon
USER docker
COPY --chown=docker ./ ./
RUN npm install
RUN npm run build

CMD ["npm", "start"]
