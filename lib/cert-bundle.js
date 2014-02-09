var fs = require('fs');
var certEndDelimiter = '-----END CERTIFICATE-----';

exports.parse = function (bundlePath) {
  var certs = [], linesForNextCert = [];
  var rawLines = fs.readFileSync(bundlePath, 'utf8').split('\n');

  for (var i = 0, l = rawLines.length; i < l; i++) {
    var line = rawLines[i];
    if (line.length <= 0) { continue; }

    linesForNextCert.push(line);
    if (line.indexOf(certEndDelimiter) !== -1) {
      var nextCert = linesForNextCert.join('\n') + "\n";
      certs.push(nextCert);
      linesForNextCert = [];
    }
  }

  return certs;
};
