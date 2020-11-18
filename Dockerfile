FROM --platform=${TARGETPLATFORM:-linux/amd64} node:15.2.1-alpine3.12

# Print build information
ARG TARGETPLATFORM
ARG BUILDPLATFORM
RUN printf "I am running on ${BUILDPLATFORM:-linux/amd64}, building for ${TARGETPLATFORM:-linux/amd64}\n$(uname -a)\n"

# Install packages
RUN apk add --no-cache chromium

# Copy CloudProxy code
USER node
RUN mkdir -p /home/node/cloudproxy
WORKDIR /home/node/cloudproxy
COPY --chown=node:node package.json ./
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node src ./src/

# Install package. Skip installing Chrome, we will use the installed package.
ENV PUPPETEER_PRODUCT=chrome \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN npm install
RUN npm run build
RUN rm -rf src tsconfig.json
RUN npm prune --production

EXPOSE 8191
CMD ["npm", "start"]