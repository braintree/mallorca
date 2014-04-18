var StatsD = require('node-statsd').StatsD;

exports.create = function create(options) {
  options = options || {};
  var client;
  if (options.statsdHost) {
    client = new StatsD({
      host: options.statsdHost,
      post: options.statsdPort,
      prefix: options.statsdPrefix ? options.statsdPrefix + '.' : ''
    });
  } else {
    client = {
      timing: function () {},
      increment: function () {},
      decrement: function () {},
      set: function () {},
      gauge: function () {},
      fake: true
    };
  }
  return client;
};
