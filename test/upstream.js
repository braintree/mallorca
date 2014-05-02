var inspect = require('util').inspect;
var url = require('url');
var childProcess = require('child_process');
var assert = require('chai').assert;
var Upstream = require('../lib/upstream');
var testServer = require('./helpers/testserver');
var fs = require('fs');

// Avoid DEPTH_ZERO_SELF_SIGNED_CERT error for self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var TESTSERVER_PORT = 9001;
var TESTSERVER_URL = url.parse('https://localhost:' + TESTSERVER_PORT);

var statsDClient = require('../lib/statsd-client').create();

describe('Upstream', function () {
  describe('using a default testserver and no agent', function () {
    var upstream = new Upstream(TESTSERVER_URL, statsDClient);
    var server = testServer.build();

    before(function() { server.listen(TESTSERVER_PORT); });

    describe('#request()', function () {
      it ('replaces the given user agent header', function (done) {
        var opts = {
          uri: '/what?no=way',
          headers: {
            foo: 'bar',
            'user-agent': 'Abc123',
            host: 'testserver'
          }
        };
        upstream.request(opts, function (err, resp, body) {
          if (err) { return done(err); }

          assert.notInclude(body, 'user-agent => Abc123');
          assert.include(body, 'user-agent => Mallorca');
          done();
        });
      });

      it('replaces the given host header', function (done) {
        var opts = {
          uri: '/dude?keep=cool',
          headers: {
            baz: 'bar',
            host: 'testserver'
          }
        };

        upstream.request(opts, function (err, resp, body) {
          if (err) { return done(err); }

          assert.notInclude(body, 'host => testserver');
          assert.include(body, 'host => localhost');
          done();
        });
      });

      it('sends the request body', function (done) {
        var REQ_BODY = "foo=bar";
        var opts = {
          uri: '/dude',
          headers: {},
          method: "POST",
          body: REQ_BODY
        };

        upstream.request(opts, function (err, resp, body) {
          assert.notOk(err);
          assert.include(body, REQ_BODY);
          done();
        });
      });
    });

    after(function() { server.close(); });
  });

  describe('using a testserver with a delay and max sockets set', function () {
    var MAX_SOCKETS = 6;
    var upstream = new Upstream(TESTSERVER_URL, statsDClient, {
      maxSockets: MAX_SOCKETS
    });
    var server = testServer.build({ delayResponse: 300 });

    before(function () { server.listen(TESTSERVER_PORT); });

    describe('and then launching a greater number of requests', function () {
      var launchCount = MAX_SOCKETS + 3;

      it('has no more than the max number of open sockets in the agent', function (done) {
        var opts = { uri: '/maxsockets?testing=' };
        var doneCalled = false;
        var responseCount = 0;
        for (var i = 0; i < launchCount; i++) {
          opts.uri += i;
          upstream.request(opts, function (err) {
            if (doneCalled) { return; }
            if (err) {
              doneCalled = true;
              return done(err);
            } else if (++responseCount >= launchCount) {
              assert.equal(server.connectionHighWaterMark, MAX_SOCKETS);
              doneCalled = true;
              return done();
            }
          });
        }
      });
    });

    after(function () { server.close(); });
  });

  describe('using a test server with a response delay set and allowing per-request timeouts', function () {
    var delayResponse = 200;
    var server = testServer.build({ delayResponse: delayResponse });
    var upstream = new Upstream(TESTSERVER_URL, statsDClient);
    upstream.allowPerRequestTimeout();

    before(function () { server.listen(TESTSERVER_PORT); });

    it('yields a timeout error when the request timeout header is less than the response delay', function (done) {
      upstream.request({ uri: '/', headers: {'X-Mallorca-Timeout': delayResponse - 100} }, function (err) {
        assert.ok(err);
        assert.equal(err.message, 'Request Timeout');
        done();
      });
    });

    it('successfully responds when the request timeout header is greater than the response delay', function (done) {
      var request = { uri: '/', headers: {'X-Mallorca-Timeout': delayResponse + 100} };
      upstream.request(request, function (err, response) {
        assert.notOk(err);
        assert.equal(response.statusCode, 200);
        done();
      });
    });

    after(function () { server.close(); });
  });

  describe('using a test with delay longer than the Upstream timeout', function () {
    var delayResponse = 200;
    var server = testServer.build({ delayResponse: delayResponse });
    var upstream = new Upstream(TESTSERVER_URL, statsDClient);
    upstream.setTimeout(delayResponse - 50);

    before(function () { server.listen(TESTSERVER_PORT); });

    it('yields a timeout error when making a request', function (done) {
      upstream.request({ uri: '/' }, function (err) {
        assert.equal(err.message, 'Request Timeout');
        done();
      });
    });
    after(function () { server.close(); });
  });

  describe('using a test server in a child process and an agent min/max sockets set', function() {
    var upstream;
    var testServerChildProcess;
    var MAX_SOCKETS = 5, KEEP_ALIVE = 2;

    before(function(done) {
      testServerChildProcess = testServer.forkChild(TESTSERVER_PORT, { delayResponse: 50 }, done);
      upstream = new Upstream(TESTSERVER_URL, statsDClient, {
        maxSockets: MAX_SOCKETS,
        maxFreeSockets: KEEP_ALIVE,
        keepAlive: true
      });
    });

    it('opens no more than max sockets', function(done) {
      var requestCnt = 0;
      for (var i = 0, l = MAX_SOCKETS + KEEP_ALIVE; i < l; i++) {
        upstream.request({ uri: '/' }, function (err) {
          requestCnt++;
          if (requestCnt === l) { done(); }
        });
      }

      var stats = upstream.getConnectionPoolStats();
      process.nextTick(function () {
        assert.equal(stats.queuedRequests, KEEP_ALIVE);
        assert.equal(stats.socketPoolSize, MAX_SOCKETS);
      });
    });

    it('leaves min sockets open', function() {
      var stats = upstream.getConnectionPoolStats();
      assert.equal(stats.socketPoolSize, KEEP_ALIVE);
      assert.equal(stats.freeSockets, KEEP_ALIVE);
    });

    after(function() {
      testServerChildProcess.kill();
    });
  });

  describe('changing the upstream socket limits', function () {
    var upstream;
    var testServerChildProcess;

    var fillSockets = function (num) {
      var cb;
      var requestCnt = 0;

      for (var i = 0, l = num; i < l; i++) {
        upstream.request({ uri: '/' }, function (err, response) {
          setTimeout(function () {
            requestCnt++;
            if (requestCnt === l) { cb(); }
          }, 0);
        });
      }

      var obj = {
        then: function (cb_) {
          cb = cb_;
          return obj;
        },
        immediately: function (cb_) {
          process.nextTick(cb_);
          return obj;
        }
      };

      return obj;
    };

    before(function(done) {
      testServerChildProcess = testServer.forkChild(TESTSERVER_PORT, { delayResponse: 10 }, done);
      upstream = new Upstream(TESTSERVER_URL, statsDClient, {
        maxSockets: 4,
        maxFreeSockets: 2,
        keepAlive: true
      });
    });

    it('handles an increase in maxsockets', function (done) {
      fillSockets(6)
        .immediately(function () {
          var stats = upstream.getConnectionPoolStats();
          assert.equal(stats.socketPoolSize, 4);
        }).then(function () {
          upstream.setPoolSizes({ max: "5" });
          fillSockets(6)
            .immediately(function () {
              var stats = upstream.getConnectionPoolStats();
              assert.equal(stats.socketPoolSize, 5);
            }).then(done);
        });
    });

    it('handles an increase in keepalive', function (done) {
      var stats = upstream.getConnectionPoolStats();
      assert.equal(stats.socketPoolSize, 2);

      upstream.setPoolSizes({ keepalive: "3" });
      fillSockets(4)
        .then(function () {
          var stats = upstream.getConnectionPoolStats();
          assert.equal(stats.keepAliveLimit, 3);
          assert.equal(stats.socketPoolSize, 3);
          done();
        });
    });

    it('handles a decrease in maxsockets', function (done) {
      fillSockets(6)
        .immediately(function () {
          var stats = upstream.getConnectionPoolStats();
          assert.equal(stats.socketPoolSize, 5);
        }).then(function () {
          upstream.setPoolSizes({ max: "4" });
          fillSockets(6)
            .immediately(function () {
              var stats = upstream.getConnectionPoolStats();
              assert.equal(stats.socketPoolSize, 4);
            }).then(done);
        });
    });

    it('handles a decrease in keepalive', function (done) {
      var stats = upstream.getConnectionPoolStats();
      assert.equal(stats.socketPoolSize, 3);

      upstream.setPoolSizes({ keepalive: "2" });
      fillSockets(3)
        .then(function () {
          var stats = upstream.getConnectionPoolStats();
          assert.equal(stats.socketPoolSize, 2);
          done();
        });
    });

    after(function() {
      testServerChildProcess.kill();
    });
  });

  describe('using a forked test server', function() {
    var upstream;
    var testServerChildProcess;

    before(function(done) {
      testServerChildProcess = testServer.forkChild(TESTSERVER_PORT, done);
      upstream = new Upstream(TESTSERVER_URL, statsDClient, { keepAlive: true });
    });

    describe('then sending a request and setting it to close the connection', function() {
      before(function(done) {
        upstream.request({uri: '/', method: 'POST', data: 'some data here'}, function(err, resp, body) {
          assert.notOk(err);
          testServerChildProcess.closeNext(done);
        });
      });

      it('does not blow up on the next request', function(done) {
        upstream.request({uri: '/', method: 'POST', data: 'some data here'}, function(err, resp, body) {
          assert.notOk(err);
          done();
        });
      });

      it('returns an error after too many timeouts', function(done) {
        var stats = upstream.getConnectionPoolStats();
        assert.equal(stats.socketPoolSize, 0);
        testServerChildProcess.closeNext(function() {
          upstream.request({uri: '/', method: 'POST', data: 'some data here', attemptLimit: 1}, function(err) {
            assert.ok(err);
            assert.equal(err.message, 'Too many retries');
            done();
          });
        });
      });
    });

    afterEach(function() {
      upstream._purge();
    });

    after(function() {
      testServerChildProcess.kill();
    });
  });

  describe('performs client signed TLS requests', function () {
    var upstream;
    var testServerChildProcess;
    var CLIENT_CERT = "test/keys/client.crt";

    before(function(done) {
      testServerChildProcess = testServer.forkChild(TESTSERVER_PORT, { clientCertificate: CLIENT_CERT }, done);
      upstream = new Upstream(TESTSERVER_URL, statsDClient, {
        cert: fs.readFileSync(CLIENT_CERT),
        key: fs.readFileSync("test/keys/client.key")
      });
    });

    it('signs the request with the client cert', function(done) {
      upstream.request({ uri: '/' }, function (err, resp) {
        assert.equal(resp.statusCode, 200);
        done();
      });
    });

    it('rejects unsigned requests', function(done) {
      var upstream = new Upstream(TESTSERVER_URL, statsDClient, {});
      upstream.request({ uri: '/' }, function (err, resp) {
        assert.equal(resp.statusCode, 401);
        done();
      });
    });

    after(function() {
      testServerChildProcess.kill();
    });
  });
});
