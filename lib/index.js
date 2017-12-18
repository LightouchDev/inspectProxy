'use strict'

const net = require('net')
const http = require('http')
const zlib = require('zlib')
const { URL } = require('url')

const portFinder = require('portfinder')

const { warn } = console
const verbose = require('debug')('verbose')

// Reconstruct headers from RawHeaders array (because nodejs ship all headers in lowercase by default)
function getHeadersFromRawHeaders (rawHeaders) {
  const headers = {}
  const _handleSetCookieHeader = function (key, value) {
    if (headers[key].constructor === Array) {
      headers[key].push(value)
    } else {
      headers[key] = [headers[key], value]
    }
  }

  if (rawHeaders) {
    for (let i = 0; i < rawHeaders.length; i += 2) {
      const key = rawHeaders[i]
      let value = rawHeaders[i + 1]

      if (typeof value === 'string') {
        value = value.replace(/\0+$/g, '') // remove null character in string end.
      }

      if (headers[key] === undefined) {
        headers[key] = value
      } else {
        // headers with same fields could be combined with comma. Ref: https://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html#sec4.2
        // set-cookie should NOT be combined. Ref: https://tools.ietf.org/html/rfc6265
        if (key.toLowerCase() === 'set-cookie') {
          _handleSetCookieHeader(key, value)
        } else {
          headers[key] = headers[key] + ',' + value
        }
      }
    }
  }
  return headers
}

class Proxy extends http.Server {
  constructor () {
    super()
    this.on('request', this.requestHandler)
    this.on('connect', this.connectHandler)
    this.on('error', this.errorHandler)
    this.resInspectCondition = () => { return false }
    this.reqInspectCondition = () => { return false }
    this.decompress = true
  }

  /**
   * Search available port and listen automatically
   * @param {Number} basePort The start port for searching
   */
  smartListen (basePort = 8000) {
    portFinder.basePort = basePort
    portFinder.getPortPromise()
      .then((port) => { this.listen(port) })
  }

  listen (port) {
    this.port = port
    super.listen(port)
    console.log(`Proxy listen on ${this.port}`)
  }

  setResInspectCondition (callback) {
    if (typeof callback !== 'function') throw new Error('require callback as argument')
    this.resInspectCondition = callback
  }

  setReqInspectCondition (callback) {
    if (typeof callback !== 'function') throw new Error('require callback as argument')
    this.reqInspectCondition = callback
  }

  requestHandler (clientRequest, proxyResponse) {
    verbose(`[Request Event] ${clientRequest.url}`)

    let remoteUrl
    try {
      remoteUrl = new URL(clientRequest.url)
    } catch (e) {
      this.emit('httpService', clientRequest, proxyResponse)
      return
    }

    const requestOptions = {
      protocol: remoteUrl.protocol,
      hostname: remoteUrl.hostname,
      port: remoteUrl.port,
      path: remoteUrl.pathname + remoteUrl.search,
      method: clientRequest.method,
      headers: getHeadersFromRawHeaders(clientRequest.rawHeaders)
    }
    // Transfer header to request
    if (requestOptions.headers['Proxy-Connection']) {
      requestOptions.headers['Connection'] = requestOptions.headers['Proxy-Connection']
      delete requestOptions.headers['Proxy-Connection']
    }

    /**
     * Stream note:
     *   (Readable IncomingMessage) clientRequest  => (Writable ClientRequest)  remoteRequest
     *   (Readable IncomingMessage) remoteResponse => (Writable ServerResponse) proxyResponse
     */
    const remoteRequest = http.request(requestOptions, (remoteResponse) => {
      proxyResponse.writeHead(remoteResponse.statusCode, getHeadersFromRawHeaders(remoteResponse.rawHeaders))
      remoteResponse.pipe(proxyResponse)

      if (this.resInspectCondition(clientRequest, remoteResponse)) {
        // collect response message
        let responseBody = []
        remoteResponse.on('data', (chunk) => { responseBody.push(chunk) })
        remoteResponse.once('end', () => {
          responseBody = Buffer.concat(responseBody)

          const resultHandler = (error, result) => {
            if (error) warn(`!!! Decompression error: ${error} in ${clientRequest.url}`)

            this.emit('getResponse', {
              url: clientRequest.url,
              body: result,
              header: remoteResponse.headers
            })
          }

          if (this.decompress && remoteResponse.headers['content-encoding']) {
            if (remoteResponse.headers['content-encoding'] === 'gzip') {
              zlib.gunzip(responseBody, resultHandler)
            } else if (remoteResponse.headers['content-encoding'] === 'deflate') {
              zlib.inflateRaw(responseBody, resultHandler)
            }
          } else {
            resultHandler(null, responseBody)
          }

          // Clean up after responseStream end
          responseBody = null
        })
      }
    })
    const requestErrorHandler = (error) => {
      warn(`!!! remoteRequest error: ${error.message}`)
      console.log(remoteRequest, proxyResponse)
      remoteRequest.abort()
      proxyResponse.writeHead(502, {
        'Proxy-Error': true,
        'Proxy-Error-Message': error.message,
        'Content-Type': 'text/html'
      })
      proxyResponse.end()
    }

    remoteRequest.on('error', requestErrorHandler)
    clientRequest.on('error', requestErrorHandler)

    if (this.reqInspectCondition(clientRequest)) {
      // Collect request message
      let requestBody = []
      clientRequest.on('data', (chunk) => { requestBody.push(chunk) })
      clientRequest.on('end', () => {
        requestBody = Buffer.concat(requestBody)
        this.emit('getRequest', {
          url: clientRequest.url,
          body: requestBody,
          header: clientRequest.headers
        })

        // Clean up after clientRequest end
        requestBody = null
      })
    }

    clientRequest.pipe(remoteRequest)
    proxyResponse.on('close', () => { remoteRequest.abort() })
  }

  connectHandler (clientRequest, clientSocket, requestHead) {
    verbose(`[Connect Event] https://${clientRequest.url}`)

    const remoteUrl = {}
    ;[remoteUrl.hostname, remoteUrl.port] = clientRequest.url.split(':')

    clientSocket.write(`HTTP/${clientRequest.httpVersion} 200 OK\r\n\r\n`, 'UTF-8')

    const remoteConnect = net.createConnection(remoteUrl.port, remoteUrl.hostname, () => {
      clientSocket.pipe(remoteConnect)
      remoteConnect.pipe(clientSocket)
    })

    remoteConnect.on('error', (error) => {
      warn('!!! remoteConnect error:', error.message)

      let errorHeader = 'Proxy-Error: true\r\n'
      errorHeader += 'Proxy-Error-Message: ' + (error.message || 'null') + '\r\n'
      errorHeader += 'Content-Type: text/html\r\n'
      clientSocket.end('HTTP/1.1 502\r\n' + errorHeader + '\r\n\r\n')
    })
  }

  errorHandler (error) {
    warn('!!! Proxy error:', error.message)
  }
}

module.exports = Proxy
module.exports.createServer = (requestListener) => { return new Proxy(requestListener) }
