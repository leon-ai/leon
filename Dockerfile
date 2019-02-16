# to build:
#   docker build -t darvin/leon .
# to pull:
#   docker pull darvin/leon
# to run:
#   docker run -p 1337:1337 -p 8889:4242 -it darvin/leon
#   docker run -p 1337:1337 -p 8889:4242 -d darvin/leon
# go to:
#   http://localhost:1337/


FROM node:10-alpine
ENV DEBIAN_FRONTEND noninteractive
ENV LC_ALL C.UTF-8
ENV LANG C.UTF-8

# Install system packages
RUN apk update --no-cache \
  && apk add --no-cache \
    ca-certificates \
    build-base \
    python3 \
    git

# Upgrade pip and install Pipenv
RUN pip3 install --upgrade pip \
	&& pip install pipenv

ENV app_root /leon
WORKDIR ${app_root}

ADD . $app_root   
COPY .env.docker  $app_root/.env    
COPY packages/leon/config/config.sample.json $app_root/packages/leon/config/config.json

RUN npm install
RUN npm run build
RUN npm run setup:offline-tts
RUN npm run setup:offline-stt


ENV PIPENV_VENV_IN_PROJECT true
RUN cd bridges/python/ ; pipenv install  ; cd ../..


RUN npm run check

EXPOSE 4242
EXPOSE 1337
CMD [ "npm", "start" ]
