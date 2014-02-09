var hostname = require('os').hostname().split('.')[0];
var programName = 'mallorca';

exports.setup = function (options) {
  programName = options.programName || programName;
};

exports.info = function(message, requestID) {
  process.stdout.write(formatMessage('INFO', requestID, message));
};

exports.error = function(message, requestID) {
  process.stderr.write(formatMessage('ERROR', requestID, message));
};

function formatMessage(level, requestID, message) {
  var logLine = [formatDate(new Date()), hostname, programName];
  if (requestID) {
    logLine.push('[' + requestID + ']');
  }
  logLine.push(level, message);
  return logLine.join(' ') + '\n';
};

function formatDate(date) {
  var time = [
    padNumber(date.getUTCHours()),
    padNumber(date.getUTCMinutes()),
    padNumber(date.getUTCSeconds())
  ].join(':');
  return [
    months[date.getUTCMonth()],
    padNumber(date.getUTCDate(), ' '),
    time
  ].join(' ');
};

function padNumber(n, c) {
  c = c || '0';
  return n < 10 ? '' + c + n : n;
}

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May',
  'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
