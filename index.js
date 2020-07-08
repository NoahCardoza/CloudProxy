const os = require('os')
const path = require('path')
const fs = require('fs')
const { v1: uuidv1 } = require('uuid')
const log = require('console-log-level')(
  {
    level: process.env.LOG_LEVEL || 'info',
    prefix (level) {
      return `${new Date().toISOString()} ${level.toUpperCase()} REQ-${reqCounter}`
    }
  }
)

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const http = require('http')
const { getCaptchaSolver } = require('./captcha')
const { deleteFolderRecursive } = require('./utils')

const pjson = require('./package.json')

const { version } = pjson
const serverPort = process.env.PORT || 8191
const serverHost = process.env.HOST || '0.0.0.0'
const logHtml = process.env.LOG_HTML || false
const sessions = {}

const CHALLENGE_SELECTORS = ['.ray_id', '.attack-box']
const TOKEN_INPUT_NAMES = ['g-recaptcha-response', 'h-captcha-response']

const captchaTypes = {
  re: 'reCaptcha',
  h: 'hCaptcha'
}

let reqCounter = 0

// setting "user-agent-override" evasion is not working for us because it can't be changed
// in each request. we set the user-agent in the browser args instead
puppeteer.use(StealthPlugin())

function errorResponse (errorMsg, res, startTimestamp) {
  log.error(errorMsg)
  const response = {
    status: 'error',
    message: errorMsg,
    startTimestamp,
    endTimestamp: Date.now(),
    version
  }
  res.writeHead(500, {
    'Content-Type': 'application/json'
  })
  res.write(JSON.stringify(response))
  res.end()
}

function successResponse (successMsg, extendedProperties, res, startTimestamp) {
  const endTimestamp = Date.now()
  log.info(`Successful response in ${(endTimestamp - startTimestamp) / 1000} s`)
  log.info(successMsg)

  const response = Object.assign(extendedProperties || {}, {
    status: 'ok',
    message: successMsg,
    startTimestamp,
    endTimestamp,
    version
  })
  res.writeHead(200, {
    'Content-Type': 'application/json'
  })
  res.write(JSON.stringify(response))
  res.end()
}

function userDataDirFromSession (session) {
  return path.join(os.tmpdir(), `/puppeteer_firefox_profile_${session}`)
}

function prepareBrowserProfile (userAgent, session) {
  const userDataDir = userDataDirFromSession(session)
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true })
  }
  const prefs = `user_pref("general.useragent.override", "${userAgent}");`
  fs.writeFile(path.join(userDataDir, 'prefs.js'), prefs, () => { })
  return userDataDir
}

function validateIncomingRequest (params, req, res, startTimestamp) {
  log.info(`Params: ${JSON.stringify(params)}`)

  if (req.method !== 'POST') {
    errorResponse('Only the POST method is allowed', res, startTimestamp)
    return false
  }

  if (req.url !== '/v1') {
    errorResponse('Only /v1 endpoint is allowed', res, startTimestamp)
    return false
  }

  if (!params.cmd) {
    errorResponse("Parameter 'cmd' is mandatory", res, startTimestamp)
    return false
  }

  return true
}

function processRequest (params, req, res, startTimestamp) {
  switch (params.cmd) {
    // EXPIRE
    case 'expire': {
      const { session } = params
      if (sessions[session]) {
        sessions[session].close()
        delete sessions[session]
        deleteFolderRecursive(userDataDirFromSession(session))
        return successResponse('The session has been removed.', null, res, startTimestamp)
      }
      return errorResponse('This session does not exist.', res, startTimestamp)
    }
    // GET
    case 'get': {
      const puppeteerOptions = {
        product: 'firefox',
        headless: true
      }

      const session = params.session || uuidv1()
      const browser = sessions[session]

      const useBrowser = async (browser) => {
        try {
          await resolveCallenge(params, browser, res, startTimestamp, session)
        } catch (error) {
          console.error(error)
          errorResponse(error.message, res, startTimestamp)
        }
      }

      if (browser) { return useBrowser(browser) }

      const reqUserAgent = params.userAgent
      if (reqUserAgent) {
        log.debug(`Using custom User-Agent: ${reqUserAgent}`)
        puppeteerOptions.userDataDir = prepareBrowserProfile(reqUserAgent, session)
      }

      log.debug('Launching headless browser...')
      return puppeteer.launch(puppeteerOptions)
        .then((browser) => {
          sessions[session] = browser
          useBrowser(browser)
        })
        .catch((error) => {
          console.error(error)
          errorResponse(error.message, res, startTimestamp)
        })
    }
    default:
      return errorResponse(`The command '${params.cmd}' is invalid.`, res, startTimestamp)
  }
}

async function resolveCallenge (params, browser, res, startTimestamp, session) {
  const page = await browser.newPage()
  if (params.userAgent) { await page.setUserAgent(params.userAgent) }
  const userAgent = await page.evaluate(() => navigator.userAgent)
  log.debug(`User-Agent: ${userAgent}`)
  const reqUrl = params.url
  const reqMaxTimeout = params.maxTimeout || 60000
  const reqCookies = params.cookies
  let message = ''

  if (reqCookies) {
    log.debug('Using custom cookies')
    await page.setCookie(...reqCookies)
  }

  log.debug(`Navegating to... ${reqUrl}`)
  const response = await page.goto(reqUrl, { waitUntil: 'domcontentloaded' })

  // detect cloudflare
  for (const selector of CHALLENGE_SELECTORS) {
    const cfChallenegeElem = await page.$(selector)
    if (cfChallenegeElem) {
      log.debug('Waiting for Cloudflare challenge...')

      // TODO: find out why these pages hang sometimes
      while (Date.now() - startTimestamp < reqMaxTimeout) {
        await page.waitFor(1000)
        try {
          // catch exception timeout in waitForNavigation
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 })
        } catch (error) { }

        const cfChallenegeElem = await page.$(selector)
        if (!cfChallenegeElem) { break }
        log.debug('Found challenege element again...')

        page.reload()
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' })
        log.debug('Reloaded page...')
      }

      if (Date.now() - startTimestamp >= reqMaxTimeout) {
        errorResponse(`Maximum timeout reached. maxTimeout=${reqMaxTimeout} (ms)`, res, startTimestamp)
        return
      }

      log.debug('Validating HTML code...')
      break
    } else {
      log.debug(`No '${selector}' challenge element detected.`)
    }
  }

  let html = await page.content()

  // look for challenge
  if (response.headers().server.startsWith('cloudflare')) {
    log.info('Cloudflare detected')

    // it seems some captcha pages return 200 sometimes
    if (response.status() === 403 || html.includes('cf_captcha_kind')) {
      if (html.includes('<span class="cf-error-code">1020</span>')) { return errorResponse('Cloudflare has blocked this request (Code 1020 Detected).', res, startTimestamp) }

      const captchaSolver = getCaptchaSolver()
      if (captchaSolver) {
        const captchaStartTimestamp = Date.now()
        const challengeForm = await page.$('#challenge-form')
        if (challengeForm) {
          const captchaType = captchaTypes[await page.evaluate((e) => e.value, await page.$('input[name="cf_captcha_kind"]'))]
          if (!captchaType) { return errorResponse('Unknown captcha type!', res, startTimestamp) }

          const sitekeyElem = await page.$('*[data-sitekey]')
          if (!sitekeyElem) { return errorResponse('Could not find sitekey!', res, startTimestamp) }
          const sitekey = await sitekeyElem.evaluate((e) => e.getAttribute('data-sitekey'))

          const token = await captchaSolver(reqUrl, sitekey, captchaType)

          for (const name of TOKEN_INPUT_NAMES) {
            const input = await page.$(`[name="${name}"]`)
            if (input) { await input.evaluate((e, token) => { e.value = token }, token) }
          }

          // ignore preset event listeners on the form
          await page.evaluate(() => {
            window.addEventListener('submit', (e) => { event.stopPropagation() }, true)
          })

          // this element is added with js and we want to wait for all the js to load before submitting
          page.waitForSelector('#challenge-form [type=submit]')

          // calculates the time it took to solve the captcha
          const captchaSolveTotalTime = Date.now() - captchaStartTimestamp

          // generates a random wait time
          const randomWaitTime = (Math.floor(Math.random() * 20) + 10) * 1000

          // waits, if any, time remaining to apper human but stay as fast as possible
          const timeLeft = randomWaitTime - captchaSolveTotalTime
          if (timeLeft > 0) { await page.waitFor(timeLeft) }

          // submit captcha response
          await Promise.all([
            challengeForm.evaluate((e) => e.submit()),
            page.waitForNavigation({ waitUntil: 'domcontentloaded' })
          ])

          // reset html
          html = await page.content()
        }
      } else {
        message = 'Captcha detected but \'CAPTCHA_SOLVER\' not set in ENV.'
      }
    }
  }

  const url = await page.url()
  log.debug(`Response URL: ${url}`)
  const cookies = await page.cookies()
  log.debug(`Response cookies: ${JSON.stringify(cookies)}`)
  if (logHtml) { log.debug(html) }

  successResponse(message, {
    session,
    solution: {
      url,
      response: html,
      cookies,
      userAgent
    }
  }, res, startTimestamp)

  page.close()
}

http.createServer((req, res) => {
  reqCounter += 1
  const startTimestamp = Date.now()
  log.info(`Incoming request: ${req.method} ${req.url}`)
  let body = []
  req.on('data', (chunk) => {
    body.push(chunk)
  }).on('end', () => {
    // parse params
    body = Buffer.concat(body).toString()
    let params = {}
    try {
      params = JSON.parse(body)
    } catch (err) {
      errorResponse('Body must be in JSON format', res, startTimestamp)
      return
    }

    // validate params
    if (!validateIncomingRequest(params, req, res, startTimestamp)) { return }

    // process request
    processRequest(params, req, res, startTimestamp)
  })
}).listen(serverPort, serverHost, () => {
  log.info(`FlareSolverr v${version} listening on http://${serverHost}:${serverPort}`)
})
