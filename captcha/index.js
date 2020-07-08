const https = require('https')
const http = require('http')
const { URL } = require('url')

const PROTOCOL_LIBRARIES = {
  [http.globalAgent.protocol]: http,
  [https.globalAgent.protocol]: https
}

const captchaSolvers = {}

function getCaptchaSolver () {
  const method = process.env.CAPTCHA_SOLVER

  if (!method) { return null }

  if (!(method in captchaSolvers)) {
    try {
      captchaSolvers[method] = require('./' + method)
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        throw Error(`The solver '${method}' is not a valid captcha solving method.`)
      } else {
        console.error(e)
        throw Error(`An error occured loading the solver '${method}'.`)
      }
    }
  }

  return captchaSolvers[method]
}

function get (url) {
  const { hostname, port, pathname, protocol } = new URL(url)
  const lib = PROTOCOL_LIBRARIES[protocol]
  const options = {
    hostname,
    path: pathname,
    port: port || lib.globalAgent.defaultPort,
    method: 'GET'
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      let body = ''
      res.on('data', buffer => { body += buffer })
      res.on('end', () => { resolve({ body, res, req }) })
    })

    req.on('error', reject)
    req.end()
  })
}

function post (url, data, contentType, opts) {
  const { hostname, port, pathname, protocol } = new URL(url)
  const lib = PROTOCOL_LIBRARIES[protocol]
  const options = Object.assign(opts || {}, {
    hostname,
    path: pathname,
    port: port || lib.globalAgent.defaultPort,
    method: 'POST',
    headers: {
      'Content-Length': data.length
    }
  })

  if (contentType) { options.headers['Content-Type'] = contentType }

  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      let body = ''
      res.on('data', buffer => { body += buffer })
      res.on('end', () => { resolve({ body, res, req }) })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
  get,
  post,
  sleep,
  getCaptchaSolver
}

// post('https://httpbin.org/post', 'this=that&that=this', 'application/x-www-form-urlencoded').then(data => {
//   console.log(data.body)
// })

// post('http://127.0.0.1:8191/v1', JSON.stringify({
//   cmd: 'get',
//   session: 'd2a7b040-be44-11ea-8b39-2f78fb6e2558',
//   url: 'http://sneakersnstuff.com'
// }), 'application/json').then(data => {
//   console.log(data.body)
// })

// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
// get('https://127.0.0.1:9999/token').then(data => {
//   console.log(data.body)
// }).catch(console.error)
