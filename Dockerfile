FROM node:14-alpine
ENV IS_DOCKER true
WORKDIR /app

# Install system packages
RUN apk add --no-cache --no-progress \
    ca-certificates \
    python3 \
    git \
    tzdata

# Upgrade pip and install Pipenv
RUN pip3 install --no-cache-dir --progress-bar off pipenv

# Install Leon
# Need to explicitly run the npm preinstall and npm posinstall scripts (not needed with npm@7)
# because npm tries to downgrade its privileges, and these scripts are not executed
COPY ./package*.json ./
RUN npm clean-install
COPY ./ ./
RUN npm run preinstall
RUN npm run postinstall
RUN npm run build

CMD ["npm", "start"]
