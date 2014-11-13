function Logger(process, options) {
  if (options.useSyslog) {
    var syslog = require('syslogudp');
    this.logger = syslog.createClient(parseInt(options.syslogPort, 10), options.syslogHost, { name: options.programName });
  } else {
    this.logger = require('./stdio-logger');
    this.logger.setup({ programName: options.programName });
  }

  process.on('log', this.formatMessage.bind(this));
};

Logger.prototype.formatMessage = function (level, line, requestID) {
  var msg = Array.prototype.slice.apply(line).join(' ');
  if (requestID) {
    msg = "[" + requestID + "] " + msg;
  }

  this.logger[level](msg);
};

module.exports = Logger;
