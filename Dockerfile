FROM node:10-alpine
WORKDIR /app
COPY . .

# Install system packages
RUN apk update --no-cache \
  && apk add --no-cache \
    ca-certificates \
    build-base \
    python3 \
    git \
    tzdata

# Upgrade pip and install Pipenv
RUN pip3 install --upgrade pip \
	&& pip install pipenv

# Install Leon
# Need to explicitly run the npm preinstall and npm posinstall scripts
# because npm tries to downgrade its privileges, and these scripts are not executed
RUN npm run preinstall
RUN npm install
RUN npm run postinstall
RUN npm run build

# Let's run it
CMD ["npm", "start"]
