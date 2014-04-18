var https = require('https');
var http = require('http');
var Watchdog = require('./watchdog');
var HttpAgent = require('agentkeepalive');
var HttpsAgent = HttpAgent.HttpsAgent;
HttpsAgent.prototype.getName = HttpAgent.prototype.getName;

function Upstream(upstreamURL, statsdClient, agentOpts) {
  if (typeof upstreamURL === 'string') {
    upstreamURL = require('url').parse(upstreamURL);
  }
  this.host = upstreamURL.hostname;
  this.protocol = upstreamURL.protocol;
  this.port = parseInt(upstreamURL.port, 10) || (this.protocol == 'https:' ? 443 : 80);
  this.httpModule = this.protocol == 'http:' ? http : https;
  this.agent = agentOpts ? createAgent(this.protocol, agentOpts) : false;
  this.dog = new Watchdog(this.port, this.host);
  this.statsdClient = statsdClient;
  if (!this.statsdClient.fake) {
    this.statsdTimer = setInterval(this.recordPoolStats.bind(this), 1000);
  }

  // Fully close the socket straightaway and remove it from the pool.
  // (Perhaps we should consider submitting a patch to agentkeepalive)
  this.agent && this.agent.on('free', function (socket, options) {
    if (!socket._closeWatch) {
      socket.on('close', function () {
        var freeSock = this.agent.freeSockets[this._agentName];
        if (freeSock) {
          var index = freeSock.indexOf(socket);
          if (index > -1) { freeSock.splice(index, 1); }
        }
        socket.destroy();
      }.bind(this));
      socket._closeWatch = true;
    }
  }.bind(this));

  this._agentName = this.agent ? this.agent.getName({
    host: this.host,
    port: this.port,
    rejectUnauthorized: agentOpts.rejectUnauthorized
  }) : '';
};

Upstream.prototype.setTimeout = function(msecs) {
  this.timeout = msecs;
};

Upstream.prototype.request = function(options, cb) {
  var request = new UpstreamRequest(options, this);
  request.send(cb);
};

Upstream.prototype.isHealthy = function() {
  return this.dog.isHealthy();
};

Upstream.prototype.stop = function () {
  clearInterval(this.statsdTimer);
};

Upstream.prototype.getConnectionPoolStats = function () {
  var freeSockets = (this.agent.freeSockets[this._agentName] || []).length;
  return {
    socketPoolSize: (this.agent.sockets[this._agentName] || []).length + freeSockets,
    freeSockets: freeSockets,
    queuedRequests: (this.agent.requests[this._agentName] || []).length,
    keepAliveLimit: this.agent.maxFreeSockets,
    socketLimit: this.agent.maxSockets
  };
};

Upstream.prototype.recordPoolStats = function () {
  this.statsdClient.gauge('sockets.free', (this.agent.freeSockets[this._agentName] || []).length);
  this.statsdClient.gauge('sockets.used', (this.agent.sockets[this._agentName] || []).length);
  this.statsdClient.gauge('queueLength', (this.agent.request[this._agentName] || []).length);
};

Upstream.prototype.setPoolSizes = function (sizes) {
  sizes = sizes || {};
  if (sizes.keepalive) { this.agent.maxFreeSockets = parseInt(sizes.keepalive, 10); }
  if (sizes.max) { this.agent.maxSockets = parseInt(sizes.max, 10); }
};

Upstream.prototype._purge = function () {
  this.agent.destroy();
  if (this.agent.freeSockets[this._agentName]) {
    delete this.agent.freeSockets[this._agentName];
  }
};

Upstream.prototype._buildRequestOptions = function(opts) {
  return {
    method: opts.method,
    hostname: this.host,
    port: this.port,
    path: opts.uri,
    agent: this.agent,
    headers: this._buildHeaders(opts.headers)
  };
};

Upstream.prototype._buildHeaders = function(downstreamHeaders) {
  downstreamHeaders = downstreamHeaders ? downstreamHeaders : {};

  var headers = {};
  for (var key in downstreamHeaders) {
    headers[key] = downstreamHeaders[key];
  }
  headers['user-agent'] = 'Mallorca';
  headers.host = this.host;
  return headers;
};

function measureElapsedTime(startTime) {
  var elapsed = process.hrtime(startTime);
  var elapsedS = elapsed[0];
  var elapsedNS = elapsed[1];
  return (elapsedS * 1e9 + elapsedNS) / 1e6;
};

function createAgent(protocol, agentOpts) {
  if (protocol === 'http:') {
    return new HttpAgent(agentOpts);
  } else {
    return new HttpsAgent(agentOpts);
  }
}

function UpstreamRequest(options, parent) {
  this.parent = parent;
  this.startTime = process.hrtime();
  this.timedOut = false;
  this.attempts = 0;
  this.attemptLimit = options.attemptLimit || 5;
  this.options = this.parent._buildRequestOptions(options);
  this.body = options.body;
};

UpstreamRequest.prototype.recordTimingStats = function (response) {
  this.parent.statsdClient.timing('waitTime', response.waitTime);
  this.parent.statsdClient.timing('responseTime', response.responseTime);
};

UpstreamRequest.prototype.send = function(cb) {
  if (++this.attempts > this.attemptLimit) {
    return cb(new Error("Too many retries"), { attempts: this.attempts }, null);
  }
  var req = this.parent.httpModule.request(this.options, function (response) {
    var upstreamBody = '';
    response.setEncoding('utf8');
    response.on('data', function (data) { upstreamBody += data; })
      .on('end', function () {
        response.responseTime = measureElapsedTime(this.startTime);
        response.waitTime = this.socketWait;
        response.attempts = this.attempts;
        this.recordTimingStats(response);
        if (!this.timedOut) { cb(null, response, upstreamBody); }
      }.bind(this));
  }.bind(this));
  if (this.parent.timeout) {
    req.setTimeout(this.parent.timeout, function () {
      this.timedOut = true;
      cb(new Error('Request Timeout'));
    }.bind(this));
  }
  req.on('socket', this.parent.dog.watch.bind(this.parent.dog))
    .on('socket', function () {
      this.socketWait = measureElapsedTime(this.startTime);
    }.bind(this))
    .on('error', this.handleError(cb));
  if (this.body) { req.write(this.body, 'utf8'); }
  req.end();
};

UpstreamRequest.prototype.handleError = function(cb) {
  return function (err) {
    if (!this.timedOut) {
      if (err.message === 'socket hang up' || err.message === 'read ECONNRESET') {
        this.send(cb);
      } else {
        cb(err);
      }
    }
  }.bind(this);
};

module.exports = Upstream;
