exports.info = function () {
  sendLog('info', arguments);
};

exports.error = function () {
  sendLog('error', arguments);
};

exports.withRequest = function (requestID) {
 return {
   info: function () {
     sendLog('info', arguments, requestID);
   },
   error: function () {
     sendLog('error', arguments, requestID);
   }
 };
};

function sendLog(level, line, requestID) {
  process.emit('log', 'info', line, requestID);
}
