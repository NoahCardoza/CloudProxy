# CloudProxy

Proxy server to bypass Cloudflare protection

:warning: This project is in beta state. Some things may not work and the API can change at any time.
See the known issues section.

## How it works

CloudProxy starts a proxy server and it waits for user requests in idle state using few resources.
When some request arrives, it uses [puppeteer](https://github.com/puppeteer/puppeteer) with the
[stealth plugin](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
to create an headless browser (Firefox). It opens the URL with user parameters and waits until the Cloudflare
challenge is solved (or timeout). The HTML code and the cookies are sent back to the user and those cookies can
be used to bypass Cloudflare using other HTTP clients.

**NOTE**: Web browsers consume a lot of memory. If you are running CloudProxy on a machine with few RAM,
do not make many requests at once. With each request a new browser is launched unless you use a session ID which is strongly recommended. However, if you use sessions, you should make sure to close them as soon as you are done using them.

## Installation

It requires NodeJS.

Run `PUPPETEER_PRODUCT=firefox npm install` to install CloudProxy dependencies.

## Usage

Run `node index.js` to start CloudProxy.

Example request:

```bash
curl -L -X POST 'http://localhost:8191/v1' \
-H 'Content-Type: application/json' \
--data-raw '{
  "cmd": "request.get",
  "url":"http://www.google.com/",
  "userAgent": "Mozilla/5.0 (X11; Linux x86_64; rv:76.0) Gecko/20100101 Firefox/76.0",
  "maxTimeout": 60000
}'
```

### Commands

#### + `sessions.create`

This will launch a new browser instance which will retain cookies until you destroy it
with `sessions.destroy`. This comes in handy so you don't have to keep solving challenges
over and over and you won't need to keep sending cookies for the browser to use.

This also speeds up the requests since it won't have to launch a new browser instance for
every request.

Parameter | Notes
|--|--|
session | Optional. The session ID that you want to be assinged to the instance. If one isn't set a random UUID will be assigned.
userAgent | Optional. Will be used by the headless browser.

#### + `sessions.list`

Returns a list of all the active sessions. More for debuging if you are curious to see
how many sessions are running. You should always make sure to properly close each
session when you are done using them as too many may slow your computer down.

Example response:

```json
{
  "sessions": [
    "session_id",
    ...
  ],
  ...
}
```

#### + `sessions.destroy`

This will properly shutdown a browser instance and remove all files associaded with it
to free up resources for a new session. Whenever you no longer need to use a session you
should make sure to close it.

Parameter | Notes
|--|--|
session | The session ID that you want to be destroyed.

#### + `request.get`

Parameter | Notes
|--|--|
url | Mandatory
session | Optional. Will send the request from and existing browser instance. If one is not sent it will create a temporary instance that will be destroyed immediately after the request is completed.
maxTimeout | Optional. Max timeout to solve the challenge
cookies | Optional. Will be used by the headless browser. Follow [this](https://github.com/puppeteer/puppeteer/blob/v3.3.0/docs/api.md#pagesetcookiecookies) format

Example response:

```json
{
  "status": "ok",
  "message": "",
  "startTimestamp": 1591679463498,
  "endTimestamp": 1591679472781,
  "version": "1.0.0",
  "solution": {
    "url": "https://www.google.com/?gws_rd=ssl",
    "response": "<!DOCTYPE html><html ...",
    "cookies": [
      {
        "name": "ANID",
        "value": "AHWqTUnRRMcmD0SxIOLAhv88SiY555FZpb4jeYCaSNZPHtYyBuY85AmaZEqLFTHe",
        "domain": ".google.com",
        "path": "/",
        "expires": 1625375465.915947,
        "size": 68,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None"
      },
      {
        "name": "1P_JAR",
        "value": "2020-6-9-5",
        "domain": ".google.com",
        "path": "/",
        "expires": 1594271465,
        "size": 16,
        "httpOnly": false,
        "secure": true,
        "session": false
      }
    ],
    "userAgent": " Mozilla/5.0 (X11; Linux x86_64; rv:76.0) Gecko/20100101 Firefox/76.0"
  }
}
```

## Environment variables

To set the environment vars in Linux run `export LOG_LEVEL=debug` and then start CloudProxy in the same shell.

Name | Default | Notes
|--|--|--|
LOG_LEVEL | info | Used to change the verbosity of the logging.
LOG_HTML | false | Used for debugging. If `true` all html that passes through the proxy will be logged to the console.
PORT | 8191 | Change this if you already have a process running on port `8191`.
HOST | 0.0.0.0 | This shouldn't need to be messed with but if you insist, it's here!
CAPTCHA_SOLVER | None | This is used to select which captcha solving method it used when a captcha is encounted.

## Captcha Solvers

### Harvester

This method makes use of the [CaptchaHarvester](https://github.com/NoahCardoza/CaptchaHarvester) project. Which allows users to collect thier own tokens from ReCaptcha V2/V3 and hCaptcha for free.

To use this method you must set these ENV variables:

```bash
CAPTCHA_SOLVER=harvester
HARVESTER_ENDPOINT=https://127.0.0.1:5000/token
```
**Note**: above I set `HARVESTER_ENDPOINT` to the default configureation
of the captcha harvester's server, but that could change if
you customize the command line flags. Simply put, `HARVESTER_ENDPOINT` should be set to the URI of the route that returns a token in plain text when called.

### Other options

More coming soon! PR's are welcome for any and all captcha solving methods and services.

## Docker

You can edit environment variables in `./Dockerfile` and build your own image.

```bash
docker build -t flaresolverr:latest .
docker run --restart=always --name flaresolverr -p 8191:8191 -d flaresolverr:latest
```

## Known issues / Roadmap

The current implementation seems to be working on the sites I have been testing them on. However, if you find it unable to access a site, open an issue and I'd be happy to investigate.

That being said, the project uses the [puppeteer stealth plugin](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth). If Cloudflare is able to detect the headless browser, it's more that projects domain to fix.

TODO:

* Fix remaining issues in the code (see TODOs in code)
* Make the maxTimeout more accurate (count the time to open the first page / maybe count the captcha solve time?)
* Add support for more HTTP methods (POST, PUT, DELETE ...)
* Add support for user HTTP headers
* Hide sensitive information in logs
* Reduce Docker image size
* Docker image for ARM architecture
* Install instructions for Windows

## Credits

Based off of ngosang's [FlareSolverr](https://github.com/ngosang/FlareSolverr).
