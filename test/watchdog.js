var inspect = require('util').inspect;
var net = require('net');
var assert = require('chai').assert;
var EventEmitter = require('events').EventEmitter;
var Watchdog = require('../lib/watchdog');

function TestSocket () {};
TestSocket.prototype = EventEmitter.prototype;

describe('Watchdog', function () {
  it('tracks whether socket is already tracked', function () {
    var testSocket = new TestSocket();
    var watchdog = new Watchdog();

    assert.isFalse(watchdog.isWatched(testSocket));
    watchdog.watch(testSocket);
    assert(watchdog.isWatched(testSocket));

    watchdog.watch(testSocket);
    assert.equal(testSocket.listeners('error').length, 1);
  });

  describe('#getScore()', function () {
    var testSocket = new TestSocket();
    var watchdog = new Watchdog();
    watchdog.watch(testSocket);
    var score = null;

    it('increases score for socket error', function (done) {
      assert.equal(watchdog.getScore(), 0);
      testSocket.on('error', function (err) {
        score = watchdog.getScore();
        assert.notEqual(score, 0);
        done();
      });
      testSocket.emit('error', new Error('connection problems'));
    });

    it('increases score for socket timeout', function(done) {
      testSocket.on('timeout', function () {
        var nextScore = watchdog.getScore();
        assert(nextScore > score);
        score = nextScore;
        done();
      });
      testSocket.emit('timeout');
    });

    it('decreases score for receiving data on socket', function (done) {
      testSocket.on('data', function () {
        var nextScore = watchdog.getScore();
        assert(nextScore < score);
        score = nextScore;
        done();
      });
      testSocket.emit('data', 'here is your data...');
    });
  });

  describe("#isHealthy()", function () {
    var testSocket = new TestSocket();
    var watchdog = new Watchdog(8765, '127.0.0.1');
    watchdog.watch(testSocket);

    it('starts out healthy', function () {
      assert(watchdog.isHealthy());
    });

    it('becomes unhealthy after some errors', function (done) {
      testSocket.emit('error');
      testSocket.emit('error');
      testSocket.on('error', function (err) {
        assert.isFalse(watchdog.isHealthy());
        done();
      });
      testSocket.emit('error');
    });

    describe("#_healthCheck()", function () {
      var timerID = 0;
      var testServer = new net.Server();

      before(function () {
        timerID = setTimeout(function () { testServer.listen(8765); }, 1500);
      });

      it('becomes healthy after test server accepts connections', function (done) {
        assert.isFalse(watchdog.isHealthy());
        testServer.on('connection', function () {
          setTimeout(function () {
            assert.isTrue(watchdog.isHealthy());
            done();
          }, 10);
        });

        testServer.on('error', function (err) {
          done(err);
        });
      });

      after(function () {
        testServer.close();
        clearTimeout(timerID);
      });
    });
  });
});
