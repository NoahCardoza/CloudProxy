FROM --platform=${TARGETPLATFORM:-linux/amd64} node:alpine

ARG TARGETPLATFORM
ARG BUILDPLATFORM
RUN printf "I am running on ${BUILDPLATFORM:-linux/amd64}, building for ${TARGETPLATFORM:-linux/amd64}\n$(uname -a)\n"

# Install packages
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      freetype-dev \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      nodejs \
      npm \
      yarn

# Tell Puppeteer to skip installing Chrome. We'll be using the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN mkdir -p /home/node/cloudproxy
WORKDIR /home/node/cloudproxy
COPY . .
RUN chown -R node:node /home/node/cloudproxy
USER node
RUN PUPPETEER_PRODUCT=chrome npm install

ENV LOG_LEVEL=info
ENV LOG_HTML=
ENV PORT=8191
ENV HOST=0.0.0.0

# ENV CAPTCHA_SOLVER=harvester|<more coming soon>...
# ENV HARVESTER_ENDPOINT=https://127.0.0.1:5000/token

EXPOSE 8191
CMD [ "npm", "start" ]