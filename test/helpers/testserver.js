var util = require('util');
var https = require('https');
var fs = require('fs');
var childProcess = require('child_process');

var buildResponser = function(req, res) {
  return function() {
    res.writeHead(200, {'X-Spam': 'Eggs'});
    res.write([req.method, req.url].join(' ') + "\n");
    res.write("Headers:\n");
    for (var header in req.headers) {
      res.write(["  *", header, "=>", req.headers[header]].join(' ') + "\n");
    }
    res.write([req.method, req.body].join(' ') + "\n");
    res.end("Ohai!\n");
  };
};

exports.build = function(options) {
  options = options ? options : {};
  var cnt = 0;

  var server = https.createServer(buildServerOpts(options), function (req, res) {
    req.body = '';
    req.on('data', function (chunk) { req.body += chunk; })
      .on('end', function () {
        if (req.client.authorized || !options.clientCertificate) {
          setTimeout(buildResponser(req, res), options.delayResponse || 0);
        } else {
          res.writeHead(401);
          res.end("Cert unauthorized - " + req.client.authorizationError + "\n");
        }
      });
  });

  server.connectionHighWaterMark = 0;
  server.on('connection', function (socket) {
    if (server.closeNext) {
      server.closeNext = false;
      socket.end();
    }
    server.getConnections(function (err, count) {
      server.connectionHighWaterMark = count > server.connectionHighWaterMark ? count : server.connectionHighWaterMark;
    });
  });
  return server;
};

function buildServerOpts(options) {
  var serverOpts = {
    cert: fs.readFileSync('test/keys/testserver.crt'),
    key: fs.readFileSync('test/keys/testserver.key')
  };

  if (options.clientCertificate) {
    serverOpts.ca = fs.readFileSync(options.clientCertificate);
    serverOpts.requestCert = true;
    serverOpts.rejectUnauthorized = false;
  }

  return serverOpts;
}

exports.forkChild = function(port, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  opts = opts || {};
  var cp = childProcess.fork(module.filename, {
    env: {TESTSERVER_PORT: port, DELAY_RESPONSE: opts.delayResponse || '', CLIENT_CERTIFICATE: opts.clientCertificate || ''},
    silent: false
  });

  if (cb) {
    cp.on('message', function readyListener (msg) {
      if (!msg['status'] || msg['status'] !== 'ready') { return; }
      cp.removeListener('message', readyListener);
      cb();
    });
  }

  cp.closeNext = function (cb) {
    cp.send({ 'action': 'closeNext' });
    var closeNextAckListener = function(msg) {
      if (msg.ack === 'closeNext') {
        cp.removeListener('message', closeNextAckListener);
        cb();
      }
    };
    cp.on('message', closeNextAckListener);
  };

  return cp;
}

// When running as a top-level script, instead of a required module:
if (typeof module.parent === 'undefined' || module.parent === null) {
  var status = 'starting';
  var server = exports.build({delayResponse: process.env.DELAY_RESPONSE, clientCertificate: process.env.CLIENT_CERTIFICATE});
  server.listen(process.env.TESTSERVER_PORT || 9001);
  status = 'ready';
  if (process.send) {
    process.send({ 'status': status });
    process.on('message', function (msg) {
      if (msg.query === 'status') { process.send({ 'status': status }); }
      if (msg.action === 'closeNext') {
        server.closeNext = true;
        process.send({ ack: 'closeNext' });
      }
    });
  }
}
