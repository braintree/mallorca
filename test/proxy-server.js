var assert = require('chai').assert;
var ProxyServer = require('../lib/proxy-server');
var request = require('request');
var fs = require('fs');

// Avoid DEPTH_ZERO_SELF_SIGNED_CERT error for self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var fakeUpstream = {
  status: 200,
  wait: 0,

  request: function(opts, cb) {
    var response = {
      statusCode: fakeUpstream.status,
      headers: {}
    };
    if (fakeUpstream.wait) {
      setTimeout(function () { cb(null, response, "Ohai"); }, fakeUpstream.wait);
    } else {
      cb(null, response, "Ohai");
    }
  },

  getConnectionPoolStats: function () {
    return {
      freeSockets: 1,
      queuedRequests: 2,
      keepAliveLimit: 3,
      socketPoolSize: 4,
      socketLimit: 5
    }
  },

  isHealthy: function () {
    return true;
  },

  setPoolSizes: function() {
    // placeholder
  }
};

var serverOpts = {
  cert: fs.readFileSync('test/keys/testserver.crt'),
  key: fs.readFileSync('test/keys/testserver.key')
};

describe('ProxyServer', function() {
  var server = new ProxyServer(serverOpts, fakeUpstream);

  describe('when talking to an upstream', function() {
    var originalRequestMethod = fakeUpstream.request;

    before(function() {
      server.listen(9002);
    });

    it('handles error responses properly', function(done) {
      fakeUpstream.request = function (_, cb) {
        cb(new Error("Upstream Error"));
      };
      request.get('https://localhost:9002', function(err, response, body) {
        assert.notOk(err);
        assert.equal(502, response.statusCode);
        done();
      });
    });

    afterEach(function() {
      fakeUpstream.request = originalRequestMethod;
    });

    after(function() {
      server.close();
    });
  });

  describe('#shutDown()', function() {

    beforeEach(function () { 
      server.listen(9002);
      assert.isFalse(server.shuttingDown);
    });

    it('responds with 503 to new requests', function(done) {
      server.shutDown(2000);
      request.get('https://localhost:9002', function(err, response, body) {
        assert.notOk(err);
        assert.equal(503, response.statusCode);
        done();
      });
    });

    it('responds to requests issued before calling #shutDown()', function(done) {
      fakeUpstream.wait = 1000;
      request.get('https://localhost:9002', function (err, response, body) {
        assert.notOk(err);
        assert.equal(200, response.statusCode);
        done();
      });
      server.once('request', function () {
        setTimeout(function () { server.shutDown(2000); }, 10);
      });
    });

    it('stops listening after the specified duration', function(done) {
      setTimeout(function() {
        request.get('https://localhost:9002', function(err, response, body) {
          assert.equal(err.code, 'ECONNREFUSED');
          done();
        });
      }, 500);
      server.shutDown(300);
    });

    afterEach(function () { server.close(); });
  });

  describe("reserved URL routes", function() {
    beforeEach(function () { 
      server.listen(9002);
      assert.isFalse(server.shuttingDown);
    });

    it("_mallorca/heartbeat", function(done) {
      request.get('https://localhost:9002/_mallorca/heartbeat', function(err, response, body) {
        assert.notOk(err);
        assert.equal(200, response.statusCode);
        fakeUpstream.isHealthy = function() { return false; };
        request.get('https://localhost:9002/_mallorca/heartbeat', function(err, response, body) {
          assert.notOk(err);
          assert.equal(503, response.statusCode);
          fakeUpstream.isHealthy = function() { return true; };
          done()
        });
      });
    });

    it("_mallorca/connection_pool", function(done) {
      fakeUpstream.setPoolSizes = function(settings) {
        assert.equal(settings.foo, "bar");
        fakeUpstream.setPoolSizes = function() {};
        done();
      };
      request.put({
        url: 'https://localhost:9002/_mallorca/connection_pool',
        body: "foo=bar"
      }, function() {});
    });

    it("_mallorca/stats", function(done) {
      request.get("https://localhost:9002/_mallorca/stats", function(err, response, body) {
        assert.match(body, /Available sockets:\s*1/);
        assert.match(body, /Total socket limit:\s*5/);
        done();
      });
    });
  });
});
