var net = require('net');

var Watchdog = function (remotePort, remoteAddress) {
  this.remotePort = remotePort;
  this.remoteAddress = remoteAddress;
  this.score = 0;
  this.threshold = 6;
  this.timer = null;
};

Watchdog.prototype.getScore = function () {
  return this.score;
};

Watchdog.prototype.watch = function (socket) {
  if (!this.isWatched(socket)) {
    socket
      .on('error', this._socketError.bind(this))
      .on('timeout', this._socketTimeout.bind(this))
      .on('data', this._socketData.bind(this))
      ._hasWatchdog = true;
  }
};

Watchdog.prototype.isWatched = function (socket) {
  return socket._hasWatchdog == true;
};

Watchdog.prototype.isHealthy = function () {
  return this.threshold > this.score;
};

Watchdog.prototype._healthCheck = function () {
  var socket = new net.Socket();
  socket.on('connect', function () {
      this.score = 0;
      clearTimeout(this.timer);
      socket.destroy();
    }.bind(this))
    .on('error', function (){})
    .connect(this.remotePort, this.remoteAddress);

  setTimeout(this._healthCheck.bind(this), 1000);
};

Watchdog.prototype._socketError = function () {
  this.score += 2;
  if (!this.isHealthy()) { setTimeout(this._healthCheck.bind(this), 1000); }
};

Watchdog.prototype._socketTimeout = function () {
  this.score += 1;
  if (!this.isHealthy()) { setTimeout(this._healthCheck.bind(this), 1000); }
};

Watchdog.prototype._socketData = function (data) {
  if (this.score > 0) { this.score -= 1; }
};

module.exports = Watchdog;
