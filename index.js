const { v1: uuidv1 } = require('uuid')
const log = require('./log')

const http = require('http')
const { getCaptchaSolver } = require('./captcha')

const pjson = require('./package.json')

const { version } = pjson
const serverPort = process.env.PORT || 8191
const serverHost = process.env.HOST || '0.0.0.0'
const logHtml = process.env.LOG_HTML || false
const sessions = require('./session')

const CHALLENGE_SELECTORS = ['.ray_id', '.attack-box']
const TOKEN_INPUT_NAMES = ['g-recaptcha-response', 'h-captcha-response']

const captchaTypes = {
  re: 'reCaptcha',
  h: 'hCaptcha'
}

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
  if (successMsg) { log.info(successMsg) }

  const response = Object.assign(extendedProperties || {}, {
    status: 'ok',
    message: successMsg || '',
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

function validateIncomingRequest (ctx, params) {
  log.info(`Params: ${JSON.stringify(params)}`)

  if (ctx.req.method !== 'POST') {
    ctx.errorResponse('Only the POST method is allowed')
    return false
  }

  if (ctx.req.url !== '/v1') {
    ctx.errorResponse('Only /v1 endpoint is allowed')
    return false
  }

  if (!params.cmd) {
    ctx.errorResponse("Parameter 'cmd' is mandatory")
    return false
  }

  return true
}

const routes = {
  'sessions.create': async (ctx, { session, userAgent }) => {
    const browser = await sessions.create(session || uuidv1(), { userAgent })
    if (browser) { ctx.successResponse('Session created successfully.', { session }) }
  },
  'sessions.list': (ctx) => {
    ctx.successResponse(null, { sessions: sessions.list() })
  },
  'sessions.destroy': (ctx, { session }) => {
    if (sessions.destroy(session)) { return ctx.successResponse('The session has been removed.') }
    ctx.errorResponse('This session does not exist.')
  },
  'request.get': async (ctx, params) => {
    const oneTimeSession = params.session === undefined
    const sessionId = params.session || uuidv1()
    const browser = oneTimeSession ? await sessions.create(sessionId, params) : sessions.get(sessionId)

    if (browser === false) {
      return ctx.errorResponse('This session does not exist. Use \'list_sessions\' to see all the existing sessions.')
    }

    const data = await resolveCallenge(ctx, params, browser)

    ctx.successResponse(data.message, {
      ...(oneTimeSession ? {} : { session: sessionId }),
      solution: data.result
    })

    if (oneTimeSession) { sessions.destroy(sessionId) }
  },
  'request.post': (ctx) => {
    ctx.errorResponse('Not implemented yet.')
  }
}

function processRequest (ctx, params) {
  const route = routes[params.cmd]
  if (route) { return route(ctx, params) }
  return ctx.errorResponse(`The command '${params.cmd}' is invalid.`)
}

async function resolveCallenge (ctx, params, browser) {
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
      while (Date.now() - ctx.startTimestamp < reqMaxTimeout) {
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

      if (Date.now() - ctx.startTimestamp >= reqMaxTimeout) {
        ctx.errorResponse(`Maximum timeout reached. maxTimeout=${reqMaxTimeout} (ms)`)
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
      if (html.includes('<span class="cf-error-code">1020</span>')) { return ctx.errorResponse('Cloudflare has blocked this request (Code 1020 Detected).') }

      const captchaSolver = getCaptchaSolver()
      if (captchaSolver) {
        const captchaStartTimestamp = Date.now()
        const challengeForm = await page.$('#challenge-form')
        if (challengeForm) {
          const captchaType = captchaTypes[await page.evaluate((e) => e.value, await page.$('input[name="cf_captcha_kind"]'))]
          if (!captchaType) { return ctx.errorResponse('Unknown captcha type!') }

          const sitekeyElem = await page.$('*[data-sitekey]')
          if (!sitekeyElem) { return ctx.errorResponse('Could not find sitekey!') }
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

  // make sure the page is closed becaue if it isn't and error will be thrown
  // when a user uses a temporary session, the browser make be quit before
  // the page is properly closed.
  await page.close()

  return {
    message,
    result: {
      url,
      response: html,
      cookies,
      userAgent
    }
  }
}

http.createServer((req, res) => {
  // count the request for the log prefix
  log.incRequests()

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

    const ctx = {
      req,
      res,
      startTimestamp,
      errorResponse: (msg) => errorResponse(msg, res, startTimestamp),
      successResponse: (msg, extendedProperties) => successResponse(msg, extendedProperties, res, startTimestamp)
    }

    // validate params
    if (!validateIncomingRequest(ctx, params)) { return }

    // process request
    try {
      processRequest(ctx, params)
    } catch (e) {
      console.error(e)
      ctx.errorResponse(e.message)
    }
  })
}).listen(serverPort, serverHost, () => {
  log.info(`FlareSolverr v${version} listening on http://${serverHost}:${serverPort}`)
})
