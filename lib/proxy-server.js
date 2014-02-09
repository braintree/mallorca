var https = require('https');
var parseURL = require('url').parse;
var util = require('util');
var log = require('./log');

function ProxyServer(options, upstream) {
  https.Server.call(this, options);
  this.upstream = upstream;

  var maxSockets = upstream.getConnectionPoolStats().socketLimit;
  this.stats = {
    responseTimes: new Array(maxSockets * 3),
    waitTimes: new Array(maxSockets * 3)
  };

  this.allowErrorRoutes = options.allowErrorRoutes;
  this.requestIDHeader = (options.requestIDHeader || '').toLowerCase();
  this.on('request', this.handleRequest.bind(this));
  this.timer = null;
  this.shuttingDown = false;
}

util.inherits(ProxyServer, https.Server);

ProxyServer.prototype.shutDown = function(duration) {
  duration = duration || 0;
  this.shuttingDown = true;
  this.timer = setTimeout(function() { this.close(); }.bind(this), duration);
};

ProxyServer.prototype.listen = function() {
  clearTimeout(this.timer);
  this.shuttingDown = false;
  https.Server.prototype.listen.apply(this, arguments);
};

ProxyServer.prototype.close = function() {
  clearTimeout(this.timer);
  if (this._handle) {
    https.Server.prototype.close.apply(this, arguments);
    this.emit('close');
  }
};

ProxyServer.prototype.handleRequest = function(req, res) {
  var requestID = req.headers[this.requestIDHeader];
  log.withRequest(requestID).info('Received request to', req.url);
  var sendResponse = function (err, opts) {
    res.writeHead(opts[0], opts[1]);
    res.end(opts[2]);
  };
  parseRequestBody(req, function (err, body) {
    if (this.shuttingDown) {
      sendResponse(null, [503, {}, 'Shutting down']);
    } else if (this.allowErrorRoutes && isErrorRequest(req)) {
      throw(new Error('Purposefully throwing error'));
    } else if (isHeartbeatRequest(req)) {
      handleHeartbeat(this.upstream, sendResponse);
    } else if (isStatisticRequest(req)) {
      handleStatistic(this.upstream, this.stats, clientWantsJSON(req), sendResponse);
    } else if (isConnectionPoolRequest(req)) {
      handleConnectionPoolChange(this.upstream, body, sendResponse);
    } else {
      handleUpstreamRequest(this.upstream, this.stats, requestID, {
        body: body,
        uri: req.url,
        method: req.method,
        headers: req.headers
      }, sendResponse);
    }
  }.bind(this));
};

module.exports = ProxyServer;

function parseRequestBody(req, cb) {
  var body = '';
  req.setEncoding('utf8');
  req
    .on('data', function(data) { body += data; })
    .on('end', function() { cb(null, body); });
}

function handleUpstreamRequest(upstream, stats, requestID, opts, cb) {
  upstream.request(opts, function (err, upstreamResponse, upstreamBody) {
    var statusCode = 500, headers = {}, body = '';
    if (err) {
      if (err.message === 'Too many retries') {
        log.withRequest(requestID).error(
          'Error on upstream request:', opts.uri, '-- Reached retry limit:', upstreamResponse.attempts);
      } else {
        log.withRequest(requestID).error('Error on upstream request:', opts.uri);
      }
      if (err.toString() === 'Request Timeout') {
        statusCode = 504;
        body = 'Upstream request timed out\n';
      } else {
        statusCode = 502;
        body = 'Error making upstream request\n';
      }
    } else {
      statusCode = upstreamResponse.statusCode;
      var attempts = upstreamResponse.attempts > 1 ? "(attempts: " + upstreamResponse.attempts + ")" : "";
      log.withRequest(requestID).info(
        'Success on upstream request:', opts.uri, '--', statusCode, 
        'elapsed', upstreamResponse.responseTime + 'ms', attempts);
      headers = upstreamResponse.headers;
      headers['X-Proxy-Server'] = 'Mallorca';
      body = upstreamBody;
      recordResponseStatistics(upstreamResponse, stats);
    }
    cb(null, [statusCode, headers, body]);
  });
}

function recordResponseStatistics(response, stats) {
  stats.responseTimes.push(response.responseTime);
  stats.responseTimes.shift();
  stats.waitTimes.push(response.waitTime);
  stats.waitTimes.shift();
}

function isHeartbeatRequest(req) {
  return req.url.match(/^\/_mallorca\/heartbeat/) && req.method === 'GET';
}

function handleHeartbeat(upstream, cb) {
  if (upstream.isHealthy()) {
    cb(null, [200, {}, 'OK']);
  } else {
    cb(null, [503, {}, 'Upstream unhealthy']);
  }
}

function isConnectionPoolRequest(req) {
  return req.url.match(/^\/_mallorca\/connection_pool/) && req.method === 'PUT';
}

function handleConnectionPoolChange(upstream, reqBody, cb) {
  try {
    upstream.setPoolSizes(JSON.parse(reqBody));
  } catch (e) {
    var querystring = require('querystring').parse;
    upstream.setPoolSizes(querystring(reqBody));
  }
  cb(null, [200, {}, 'OK']);
}

function isErrorRequest(req) {
  return req.url.match(/^\/_mallorca\/uncaught_error/) && req.method === 'POST';
}

function isStatisticRequest(req) {
  return req.url.match(/^\/_mallorca\/stat/) && req.method === 'GET';
}

function clientWantsJSON(req) {
  return parseURL(req.url).pathname.match(/\.json$/) || (req.headers.accept && req.headers.accept.match(/json/i));
}

function handleStatistic(upstream, requestStats, respondAsJSON, cb) {
  var body = '';
  var averageResponseTime = average(requestStats.responseTimes);
  var averageWaitTime = average(requestStats.waitTimes);
  var averageUpstreamTime = averageResponseTime - averageWaitTime;
  var percentileResponseTime = percentile(requestStats.responseTimes, 0.9);
  var percentileWaitTime = percentile(requestStats.waitTimes, 0.9);
  var percentileUpstreamTime = percentileResponseTime - percentileWaitTime;
  var poolStats = upstream.getConnectionPoolStats();

  if (respondAsJSON) {
    body = JSON.stringify({
      active_connections: (poolStats.socketPoolSize - poolStats.freeSockets),
      available_sockets: poolStats.freeSockets,
      queued_requests: poolStats.queuedRequests,
      keepalive_socket_limit: poolStats.keepAliveLimit,
      total_socket_limit: poolStats.socketLimit,
      socket_wait_average: averageWaitTime,
      socket_wait_90th_percentile: percentileWaitTime,
      upstream_response_average: averageUpstreamTime,
      upstream_response_90th_percentile: percentileUpstreamTime,
      response_average: averageResponseTime,
      response_90th_percentile: percentileResponseTime
    });
  } else {
    body += "Active connections: " + (poolStats.socketPoolSize - poolStats.freeSockets) + "\n";
    body += "Available sockets: " + (poolStats.freeSockets) + "\n";
    body += "Queued requests: " + poolStats.queuedRequests + "\n\n";

    body += "KeepAlive socket limit: " + poolStats.keepAliveLimit + "\n";
    body += "Total socket limit: " + poolStats.socketLimit + "\n\n";

    body += "                        Average     90th percentile\n";
    body += "Socket wait MS       " + leftPad(averageWaitTime.toFixed(3), 10) + leftPad(percentileWaitTime.toFixed(3), 13) + '\n';
    body += "Upstream response MS " + leftPad(averageUpstreamTime.toFixed(3), 10) + leftPad(percentileUpstreamTime.toFixed(3), 13) + '\n';
    body += "Response MS          " + leftPad(averageResponseTime.toFixed(3), 10) + leftPad(percentileResponseTime.toFixed(3), 13) + '\n';
  }

  cb(null, [200, {}, body]);
}

function leftPad(str, n) {
  str = String(str);
  return new Array(n - str.length + 1).join(' ') + str;
}

function percentile(numbers, p) {
  numbers = numbers.filter(function (a) { return a; });
  var take = Math.floor(numbers.length * p);
  return numbers.sort(function(a, b) { return a - b; })[take] || NaN;
}

function average(numbers) {
  var count = numbers.reduce(function(count, n) { return n ? count + 1: n; }, 0);
  var sum = numbers.reduce(function(sum, n) { return sum + (n || 0); }, 0);
  return sum / count;
}
