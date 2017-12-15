'use strict'

const HttpProxy = require('./lib')
const zlib = require('zlib')

const proxy = HttpProxy.createServer()
proxy.decompressor = false // set false to dump raw message body from response only, default: true

// Inspect response with html and json content only
proxy.setResInspectCondition((clientRequest, remoteResponse) => {
  const contentType = remoteResponse.headers['content-type']
  if (contentType) {
    if (
      contentType.indexOf('text/html') !== -1 ||
      contentType.indexOf('application/json') !== -1
    ) {
      return true
    }
  }
  return false
})
// Inspect all request
proxy.setReqInspectCondition(() => { return true })

proxy.smartListen(55688) // I want proxy search available port start from 55688

// Generate PAC content dynamically
function generatePAC () {
  return `
    function FindProxyForURL (url, host) {
      if (host === 'example.com' || host === 'whatismyipaddress.com') {
        return 'PROXY localhost:${proxy.port}'
      }
      return 'DIRECT'
    }
  `
}

// Host a PAC file for this proxy
proxy.on('httpService', (request, response) => {
  response.setHeader('Connection', 'close') // Connection is 'keep-alive' by default, but we don't need it.

  if (request.url === '/proxy.pac') {
    response.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig')
    response.end(generatePAC())
  } else {
    response.end('Service OK!')
  }
})

// get request from client
proxy.on('getRequest', (request) => console.log('request', request))

// get response body from remote and decode
proxy.on('getResponse', (response) => {
  const resultHandler = (error, result) => {
    if (error) console.error('Decompressor throw error:', error)
    console.log(result.toString()) // result is <Buffer>, append .toString() to convert into plain text.
  }

  // proxy.decodeMessage is false, we must decode ourself.
  if (response.header['Content-Encoding'] === 'gzip') {
    zlib.gunzip(response.body, resultHandler)
  } else if (response.header['Content-Encoding'] === 'deflate') {
    zlib.inflateRaw(response.body, resultHandler)
  }
})
