FROM node:10-alpine
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

COPY . .

# Install Leon
# Need to explicitly run the npm preinstall and npm posinstall scripts
# because npm tries to downgrade its privileges, and these scripts are not executed
RUN npm run preinstall
RUN npm install
RUN npm run postinstall
RUN npm run build

# Let's run it
CMD ["npm", "start"]
