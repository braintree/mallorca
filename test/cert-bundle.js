var assert = require('chai').assert;
var certBundle = require('../lib/cert-bundle');

describe('cert-bundle module', function () {
  describe('parse()', function () {
    it('returns an empty array for an empty file', function () {
      var certs = certBundle.parse('./test/keys/empty.crt');
      assert.equal(certs.length, 0);
    });

    it('returns an array containing the expected certificates', function () {
      var certs = certBundle.parse('./test/keys/ca-certificates.crt');
      assert.equal(certs.length, 159);
      var firstLineOfFourthCert = 'MIIENjCCAx6gAwIBAgIBATANBgkqhkiG9w0BAQUFADBvMQswCQYDVQQGEwJTRTEU';
      assert.notEqual(certs[3].indexOf(firstLineOfFourthCert), -1);
    });

    it('returns certificate strings ending with a line feed', function () {
      var certs = certBundle.parse('./test/keys/ca-certificates.crt');
      require('util').inspect(certs, { colors: true });
      assert(certs.every(function (cert) {
        return cert[cert.length-1] === '\n';
      }));
    });
  });
});
