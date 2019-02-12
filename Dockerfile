FROM mhart/alpine-node:10
WORKDIR /app
COPY . .

# Update & Install dependencies
RUN apk add --no-cache --update \
    git \
    bash \
    libffi-dev \
    openssl-dev \
    bzip2-dev \
    zlib-dev \
    readline-dev \
    sqlite-dev \
    build-base

RUN apk add linux-headers 

# Set Python version
ARG PYTHON_VERSION='3.6.0'
# Set pyenv home
ARG PYENV_HOME=/root/.pyenv


# Install pyenv, then install python versions
RUN git clone --depth 1 https://github.com/pyenv/pyenv.git $PYENV_HOME && \
    rm -rfv $PYENV_HOME/.git

ENV PATH $PYENV_HOME/shims:$PYENV_HOME/bin:$PATH

RUN pyenv install $PYTHON_VERSION
RUN pyenv global $PYTHON_VERSION
RUN pip install --upgrade pip && pyenv rehash
# Clean
RUN rm -rf ~/.cache/pip

# Install missing dependencies
RUN pip install pipenv
RUN pipenv run pipenv install tinydb

# Install Leon
RUN npm install
RUN npm run build

# Let's run it 
CMD ["npm", "run", "start"]
