FROM node:16.18.0
ENV IS_DOCKER true

# Run the container as an unprivileged user
RUN groupadd docker && useradd -g docker -s /bin/bash -m docker
WORKDIR /home/docker/leon
RUN chown --recursive docker /home/docker/leon
USER docker

COPY --chown=docker ./ ./
RUN npm install
RUN npm run build

CMD ["npm", "start"]
