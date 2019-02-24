FROM node:10-alpine

# Install system packages
# and upgrade pip and install Pipenv
RUN apk update --no-cache && \
    apk add --no-cache \
      ca-certificates \
      build-base \
      python3 \
      git \
      tzdata && \
    pip3 install --upgrade pip && \
    pip install pipenv

# Handle Node dependancies
WORKDIR /app
COPY package.json /app
RUN npm install

# Install Leon
# Need to explicitly run the npm preinstall and npm posinstall scripts
# because npm tries to downgrade its privileges, and these scripts are not executed
COPY . /app
RUN npm run postinstall
RUN npm run build

# Let's run it
CMD ["npm", "start"]
