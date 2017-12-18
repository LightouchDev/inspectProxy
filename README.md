# inspectProxy

> a http proxy to inspect request / response

[![Travis Build Status](https://travis-ci.org/LightouchDev/inspectProxy.svg)](https://travis-ci.org/LightouchDev/inspectProxy) [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/LightouchDev/inspectProxy/blob/master/LICENSE)

[![JavaScript Style Guide](https://cdn.rawgit.com/standard/standard/master/badge.svg)](https://github.com/standard/standard)

## Install

```shell
yarn add https://github.com/LightouchDev/inspectProxy
```

## Usage

inspectProxy inherits from `http.Server` and has the following additional events:

### Event: 'getRequest'

* `request` \<Object>
  * `url` \<String> Request url
  * `body` \<Buffer> Request message body
  * `header` \<Object> Request header

Emitted each time there is a request. `body` may be an empty \<Buffer>, append `toString()` to inspect content.

### Event: 'getResponse'

* `request` \<Object>
  * `url` \<String> Origin request url
  * `body` \<Buffer> Response message body
  * `header` \<Object> Response header

Emitted each time when a response is received. `body` may be an empty \<Buffer>, append `toString()` to inspect content.

### Event: 'httpService'

* `request` \<http.IncomingMessage>
* `response` \<http.ServerResponse>

It's emitted in `request` event, and emitted only when request url is not contained hostname.

```shell
# this emit event
$ curl http://PROXY-ADDRESS:PORT/some-path # request.url === '/some-path'

# this wouldn't
$ curl --proxy http://PROXY-ADDRESS:PORT/ http://example.com/ # request.url === 'http://example.com/'
```

### proxy.port

The port that proxy using for listening.

### proxy.decompress

The switch to decompress message body from remote response according to `Content-Encoding` header. default: `true`

### proxy.setReqInspectCondition(callback)

* `callback` \<Function>
  * `clientRequest` \<http.IncomingMessage> Request from client

Set which request condition should be inspected, callback should return `true` to inspect current request.

### proxy.setResInspectCondition(callback)

* `callback` \<Function>
  * `clientRequest` \<http.IncomingMessage> Request from client
  * `remoteResponse` \<http.IncomingMessage> Response from remote server

Set which response condition should be inspected, callback should return `true` to inspect current response.

### proxy.smartListen([basePort])

* basePort \<Number> The base port to start finding. default: `8000`

Proxy would check available port and start listening. if port unavailable, it would try next port until found.

As `http.listen()`, it would emit `listening` event when proxy start listening.

### Example

See [example](example.js)

## Thanks to

* Design reference: [AnyProxy](https://github.com/alibaba/anyproxy)

## Note

* **No https inspect**
  * All https connection is bypassed.
* **No websocket inspect**
  * Websocket support is in plan, but no ETA.
* **Performance cost**
  * This proxy add about **5~7ms** latency in each response with about **0.035%** response lost.
  * (test in [vegeta](https://github.com/tsenart/vegeta) with gzip-enabled nginx default page)

## LICENSE

MIT