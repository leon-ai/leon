FROM node:10-alpine
WORKDIR /app
COPY . .

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

# Install Leon
RUN npm install
RUN npm run build
RUN npm run postinstall

# Let's run it 
CMD ["npm", "run", "start"]
