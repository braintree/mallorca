var url = require('url');
var optimist = require('optimist');

exports.parseAndValidate = function(argv) {
  var parsedArgs = parse(argv);
  var niceArgs = prettifyArgNames(parsedArgs);
  validate(niceArgs);
  return niceArgs;
}

function parse(argv) {
  var args = optimist
    .usage('Man-in-the-middle proxying for HTTP/HTTPS.\nUsage: $0 [options] UPSTREAM_HOST_OR_URL')
    .options('cert', {describe: 'SSL certificate for proxy', demand: true})
    .options('key', {describe: 'SSL key for proxy', demand: true})
    .options('port', {default: 7000, describe: 'Port to listen on'})
    .options('keepalive-socket-count', {default: 10, describe: 'Number of connections to keep open when no more requests are queued'})
    .options('maxsockets', {default: 20, describe: 'Maximum number of connections to the upstream server'})
    .describe('cacert', 'File containing CA root certificates used to verify upstream HTTPS requests. If not provided, the default node.js CA root certificates will be used.')
    .describe('pidfile', 'Write out process ID to a file')
    .options('timeout', {default: 20000, describe: 'Maximum time to wait for a response to the upstream request'})
    .options('allow-per-request-timeout', {describe: 'Allows individual requests to set their own upstream timeout in milliseconds by providing an X-Mallorca-Timeout header'})
    .options('allow-error-routes', {describe: 'Enables routes to purposefully throw errors', boolean: true})
    .options('skip-upstream-ssl-verification', {describe: "Don't verify the SSL certificate of the upstream server", boolean: true})
    .describe('client-cert', 'Certificate used to authenticate requests to upstream server')
    .describe('client-key', 'Key used (along with --client-cert) to authenticate with upstream server')
    .describe('request-id-header', 'Header from downstream request used to identify request in log entries')
    .options('use-syslog', {describe: 'Send log messages to syslog, instead of stdout/stderr', boolean: true})
    .options('syslog-port', {default: 514, describe: 'UDP port for logging via syslog.'})
    .options('syslog-host', {default: 'localhost', describe: 'Host for logging via syslog.'})
    .options('program-name', {default: 'mallorca', describe: 'Identifies Mallorca process in logging output.'})
    .options('secure-protocol', {default: undefined, describe: 'Force SSL method to use, see: http://nodejs.org/api/https.html#https_https_request_options_callback'})
    .describe('statsd-host', 'Host to log connection counts and request timings in StatsD.')
    .options('statsd-port', {default: 8125, describe: 'Port the StatsD server is listening on.'})
    .describe('statsd-prefix', 'String to prepend to StatsD metric names.')
    .options('help', {alias: 'h', boolean: true, describe: 'Show this help message'})
    .parse(argv);
  args.upstreamURL = parseUpstreamURL(args);
  return args;
}

function parseUpstreamURL(args) {
  // Should look like, when running from ./bin/mallorca script:
  // [ 'node', '/path/to/mallorca/bin/mallorca', 'hostname:1234' ]
  var input = args._[2];

  if (input == null || typeof input === 'undefined') {
    return null;
  } else if (input.match(/^[^:]+:\/\//)) {
    return url.parse(input);
  } else {
    return url.parse('https://' + input);
  }
}

function prettifyArgNames(parsedArgs) {
  return {
    cert: parsedArgs.cert,
    key: parsedArgs.key,
    port: parsedArgs.port,
    keepaliveSocketCount: parsedArgs['keepalive-socket-count'],
    maxSockets: parsedArgs.maxsockets,
    caCert: parsedArgs.cacert,
    pidFile: parsedArgs.pidfile,
    timeout: parsedArgs.timeout,
    allowPerRequestTimeout: parsedArgs['allow-per-request-timeout'],
    allowErrorRoutes: parsedArgs['allow-error-routes'],
    skipUpstreamSSLVerification: parsedArgs['skip-upstream-ssl-verification'],
    clientCert: parsedArgs['client-cert'],
    clientKey: parsedArgs['client-key'],
    requestIDHeader: parsedArgs['request-id-header'],
    upstreamURL: parsedArgs.upstreamURL,
    useSyslog: parsedArgs['use-syslog'],
    syslogPort: parsedArgs['syslog-port'],
    syslogHost: parsedArgs['syslog-host'],
    programName: parsedArgs['program-name'],
    secureProtocol: parsedArgs['secure-protocol'],
    statsdHost: parsedArgs['statsd-host'],
    statsdPort: parsedArgs['statsd-port'],
    statsdPrefix: (parsedArgs['statsd-prefix'] || parsedArgs['program-name']),
    help: parsedArgs.help
  };
}

function validate(args) {
  if (args.help) {
    throw new Error(optimist.help());
  }

  if (args.upstreamURL == null || typeof args.upstreamURL === 'undefined') {
    throw new Error(optimist.help() + 'Must provide UPSTREAM_HOST_OR_URL\n');
  } else if (!args.upstreamURL.protocol.match(/^https?:$/)) {
    throw new Error(optimist.help() + 'UPSTREAM_HOST_OR_URL must be host name or a valid http/https URL');
  }
}
