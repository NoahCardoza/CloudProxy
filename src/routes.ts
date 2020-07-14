import { v1 as UUIDv1 } from 'uuid'
import * as sessions from './session'
import { RequestContext } from './types'
import log from './log'
import { Browser, SetCookie } from 'puppeteer'
import getCaptchaSolver, { CaptchaType } from './captcha'

export interface BaseAPICall {
  cmd: string
}

interface BaseSessionsAPICall extends BaseAPICall {
  session?: string
}

interface SessionsCreateAPICall extends BaseSessionsAPICall {
  userAgent?: string
}

interface BaseRequestAPICall extends BaseAPICall {
  url: string
  session?: string
  userAgent?: string
  maxTimeout?: number
  cookies?: SetCookie[]
}


interface Routes {
  [key: string]: (ctx: RequestContext, params: BaseAPICall) => void | Promise<void>
}

interface ChallenegeResolutionResultT {
  url: string
  response: string,
  cookies: object[]
  userAgent: string
}

interface ChallenegeResolutionT {
  message: string
  result: ChallenegeResolutionResultT
}

const CHALLENGE_SELECTORS = ['.ray_id', '.attack-box']
const TOKEN_INPUT_NAMES = ['g-recaptcha-response', 'h-captcha-response']

async function resolveCallenge(ctx: RequestContext, params: BaseRequestAPICall, browser: Browser): Promise<ChallenegeResolutionT | void> {
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
    await page.setCookie(...(reqCookies))
  }

  log.debug(`Navegating to... ${reqUrl}`)
  const response = await page.goto(reqUrl, { waitUntil: 'domcontentloaded' })

  // look for challenge
  if (response.headers().server.startsWith('cloudflare')) {
    log.info('Cloudflare detected')

    if (await page.$('.cf-error-code')) {
      await page.close()
      return ctx.errorResponse('Cloudflare has blocked this request (Code 1020 Detected).')
    }

    if (response.status() === 403) {
      // detect cloudflare wait 5s
      for (const selector of CHALLENGE_SELECTORS) {
        const cfChallenegeElem = await page.$(selector)
        if (cfChallenegeElem) {
          log.html(await page.content())
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
    }

    // it seems some captcha pages return 200 sometimes
    if (await page.$('input[name="cf_captcha_kind"]')) {
      const captchaSolver = getCaptchaSolver()
      if (captchaSolver) {
        const captchaStartTimestamp = Date.now()
        const challengeForm = await page.$('#challenge-form')
        if (challengeForm) {
          log.html(await page.content())
          const captchaTypeElm = await page.$('input[name="cf_captcha_kind"]')
          const cfCaptchaType: string = await captchaTypeElm.evaluate((e: any) => e.value)
          const captchaType: CaptchaType = (CaptchaType as any)[cfCaptchaType]
          if (!captchaType) { return ctx.errorResponse('Unknown captcha type!') }

          const sitekeyElem = await page.$('*[data-sitekey]')
          if (!sitekeyElem) { return ctx.errorResponse('Could not find sitekey!') }
          const sitekey = await sitekeyElem.evaluate((e) => e.getAttribute('data-sitekey'))

          log.info('Waiting to recive captcha token to bypass challenge...')
          const token = await captchaSolver({
            hostname: (new URL(reqUrl)).hostname,
            sitekey,
            type: captchaType
          })

          for (const name of TOKEN_INPUT_NAMES) {
            const input = await page.$(`textarea[name="${name}"]`)
            if (input) { await input.evaluate((e: HTMLTextAreaElement, token) => { e.value = token }, token) }
          }

          // ignore preset event listeners on the form
          await page.evaluate(() => {
            window.addEventListener('submit', (e) => { event.stopPropagation() }, true)
          })

          // this element is added with js and we want to wait for all the js to load before submitting
          await page.waitForSelector('#challenge-form [type=submit]')

          // calculates the time it took to solve the captcha
          const captchaSolveTotalTime = Date.now() - captchaStartTimestamp

          // generates a random wait time
          const randomWaitTime = (Math.floor(Math.random() * 20) + 10) * 1000

          // waits, if any, time remaining to apper human but stay as fast as possible
          const timeLeft = randomWaitTime - captchaSolveTotalTime
          if (timeLeft > 0) { await page.waitFor(timeLeft) }

          // submit captcha response
          challengeForm.evaluate((e: HTMLFormElement) => e.submit())
          await page.waitForNavigation({ waitUntil: 'domcontentloaded' })
        }
      } else {
        message = 'Captcha detected but \'CAPTCHA_SOLVER\' not set in ENV.'
      }
    }
  }

  const url = page.url()
  log.debug(`Response URL: ${url}`)
  const cookies = await page.cookies()
  log.debug(`Response cookies: ${JSON.stringify(cookies)}`)
  const html = await page.content()
  log.html(html)

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

export const routes: Routes = {
  'sessions.create': async (ctx, { session, userAgent }: SessionsCreateAPICall) => {
    const browser = await sessions.create(session || UUIDv1(), { userAgent })
    if (browser) { ctx.successResponse('Session created successfully.', { session }) }
  },
  'sessions.list': (ctx) => {
    ctx.successResponse(null, { sessions: sessions.list() })
  },
  'sessions.destroy': async (ctx, { session }: BaseSessionsAPICall) => {
    if (await sessions.destroy(session)) { return ctx.successResponse('The session has been removed.') }
    ctx.errorResponse('This session does not exist.')
  },
  'request.get': async (ctx, params: BaseRequestAPICall) => {
    const oneTimeSession = params.session === undefined
    const sessionId = params.session || UUIDv1()
    const browser = oneTimeSession
      ? await sessions.create(sessionId, { userAgent: params.userAgent })
      : sessions.get(sessionId)

    if (browser === false) {
      return ctx.errorResponse('This session does not exist. Use \'list_sessions\' to see all the existing sessions.')
    }

    const data = await resolveCallenge(ctx, params, browser)

    if (data) {
      ctx.successResponse(data.message, {
        ...(oneTimeSession ? {} : { session: sessionId }),
        solution: data.result
      })
    }

    if (oneTimeSession) { sessions.destroy(sessionId) }
  },
  'request.post': (ctx) => {
    ctx.errorResponse('Not implemented yet.')
  }
}

export default async function Router(ctx: RequestContext, params: BaseAPICall): Promise<void> {
  const route = routes[params.cmd]
  if (route) { return await route(ctx, params) }
  return ctx.errorResponse(`The command '${params.cmd}' is invalid.`)
}