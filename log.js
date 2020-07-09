let requests = 0

module.exports = {
  incRequests: () => { requests++ },
  ...require('console-log-level')(
    {
      level: process.env.LOG_LEVEL || 'info',
      prefix (level) {
        return `${new Date().toISOString()} ${level.toUpperCase()} REQ-${requests}`
      }
    }
  )

}
