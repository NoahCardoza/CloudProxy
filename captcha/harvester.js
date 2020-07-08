const { get, sleep } = require('./index')

/*
    This method uses the captcha-harvester project:
        https://github.com/NoahCardoza/CaptchaHarvester

    While the function must take url/sitekey/type args,
    they aren't used because the harvester server must
    be preconfigured.

    ENV:
        HARVESTER_ENDPOINT: This must be the full path
        to the /token endpoint of the harvester.
        E.G. "https://127.0.0.1:5000/token"
*/

module.exports = async function solve (url, sitekey, type) {
  const endpoint = process.env.HARVESTER_ENDPOINT
  if (!endpoint) { throw Error('ENV variable `HARVESTER_ENDPOINT` must be set.') }

  // work around for the harvester's self-signed cert
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  while (true) {
    const { body, res } = await get(process.env.HARVESTER_ENDPOINT)
    if (res.statusCode === 200) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'
      return body
    }
    await sleep(3000)
  }
}
