const fs = require('fs')
const Path = require('path')
const { promisify } = require('util')
const sleep = promisify(setTimeout)

// recursive fs.rmdir needs node version 12:
// https://github.com/ngosang/FlareSolverr/issues/5#issuecomment-655572712
function deleteFolderRecursive (path) {
  if (fs.existsSync(path)) {
    fs.readdirSync(path).forEach((file, index) => {
      const curPath = Path.join(path, file)
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath)
      } else { // delete file
        fs.unlinkSync(curPath)
      }
    })
    fs.rmdirSync(path)
  }
}

module.exports = {
  deleteFolderRecursive,
  sleep
}
