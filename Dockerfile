FROM --platform=${TARGETPLATFORM:-linux/amd64} node:15.2.1-alpine3.11

# Print build information (ARGS are automatic, and target can be set)
ARG TARGETPLATFORM
ARG BUILDPLATFORM
RUN printf "I am running on ${BUILDPLATFORM:-linux/amd64}, building for ${TARGETPLATFORM:-linux/amd64}\n$(uname -a)\n"

# Install Chromium and dumb-init and remove all locales but en-US
RUN apk add --no-cache chromium dumb-init && \
    find /usr/lib/chromium/locales -type f ! -name 'en-US.*' -delete

# Copy needed files into ~/cloudproxy/
USER node
RUN mkdir -p /home/node/cloudproxy
WORKDIR /home/node/cloudproxy
COPY --chown=node:node package.json package-lock.json tsconfig.json LICENSE ./
COPY --chown=node:node src ./src/

# Skip installing Chrome, we will use the installed package.
ENV PUPPETEER_PRODUCT=chrome \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install, build, and remove source code & dev packages
RUN npm install && \
    npm run build && \
    rm -rf src tsconfig.json && \
    npm prune --production

EXPOSE 8191
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["npm", "start"]
