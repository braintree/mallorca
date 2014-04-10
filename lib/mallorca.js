var fs = require('fs');
var formatURL = require('url').format;
var parseCertBundle = require('./cert-bundle').parse;
var Upstream = require('./upstream');
var ProxyServer = require('./proxy-server');
var log = require('./log');

function Mallorca(options) {
  this.upstreamURL = options.upstreamURL;
  this.port = options.port;
  this.timeout = options.timeout;

  this.upstream = new Upstream(options.upstreamURL, {
    ca: options.caCert ? parseCertBundle(options.caCert) : null,
    cert: options.clientCert ? fs.readFileSync(options.clientCert) : null,
    key: options.clientKey ? fs.readFileSync(options.clientKey) : null,
    maxSockets: options.maxSockets,
    maxFreeSockets: options.keepaliveSocketCount,
    keepAlive: true,
    keepAliveMsecs: -1,
    rejectUnauthorized: !options.skipUpstreamSSLVerification,
    secureProtocol: options.secureProtocol
  });

  this.server = new ProxyServer({
    cert: fs.readFileSync(options.cert),
    key: fs.readFileSync(options.key),
    requestIDHeader: options.requestIDHeader,
    allowErrorRoutes: options.allowErrorRoutes
  }, this.upstream);
}

Mallorca.prototype.start = function () {
  log.info("Starting proxy for", formatURL(this.upstreamURL), "on port", this.port);
  this.server.listen(this.port);
};

Mallorca.prototype.stop = function (cb) {
  this.server.shutDown(this.timeout);
  this.server.once('close', cb);
};

module.exports = Mallorca;
