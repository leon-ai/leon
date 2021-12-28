FROM node:16-alpine
ENV IS_DOCKER true
WORKDIR /app

# Install system packages
RUN apk add --no-cache --no-progress \
  ca-certificates \
  py3-pip \
  git \
  tzdata

# Upgrade pip and install Pipenv
RUN pip3 install --no-cache-dir --progress-bar off pipenv

# Install Leon
COPY ./ ./
RUN npm install
RUN npm run build

CMD ["npm", "start"]
