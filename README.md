# Mallorca

Man-in-the-middle proxy for HTTPS with SSL verification and connection pooling/keep-alive.

[![No Maintenance Intended](http://unmaintained.tech/badge.svg)](http://unmaintained.tech/)
[![Build Status](https://travis-ci.org/braintree/mallorca.png?branch=master)](https://travis-ci.org/braintree/mallorca)

## DEPRECATED

Braintree no longer uses or maintains this project. It remains available for
research and derivative works, subject to the project's license.

## Installation

    $ npm -g install mallorca

## Usage

    $ mallorca \
      --cert /etc/ssl/certs/your-mallorca-proxy.crt \
      --key /etc/ssl/certs/your-mallorca-proxy.key \
      --port 5000 \
      --maxsockets 20 \
      --keepalive-socket-count 10 \
      --pidfile /var/run/mallorca.pid \
      --cacert /etc/ssl/certs/ca-root-for-externalsite.pem \
      www.someexternalsite.com

## Development

Ensure you have the following dependencies installed and in your PATH:

* node (version > 0.10 should do)
* npm

Then, you should be able to run the tests:

    $ npm test

Finally, to launch Mallorca:

    $ ./bin/mallorca YOUR OPTIONS HERE...

## Reserved routes

The following routes are reserved for the operation of the Mallorca proxy, and are not
proxied to the upstream web server.

    GET /_mallorca/heartbeat

Indicates whether Mallorca can consistently maintain its connection to the upstream server. A
response code of 200 indicates a healthy connection, 503 indicates connection problems.

    PUT /_mallorca/connection_pool

Enables changing connection pool settings without having to restart Mallorca. Accepts a payload
of either a JSON object or form encoded key-values:

`max` - Maximum number of connections to the upstream server

`keepalive` - Number of connections to keep open when no more requests are queued

    GET /_mallorca/uncaught_error

Simulates an internal error within the Mallorca proxy, does not respond. You must have set the
allow-error-routes command line switch to use this route.

    GET /_mallorca/stat

Provides statistics for the connection pool and latencies of recent requests to the upstream server.

## Contributing

1. Fork it
2. Create your feature branch (`git checkout -b my-new-feature`)
3. Commit your changes (`git commit -am 'Added some feature'`)
4. Push to the branch (`git push origin my-new-feature`)
5. Create new Pull Request
