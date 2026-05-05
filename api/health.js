'use strict';

const { version } = require('../package.json');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).end();

  return res.status(200).json({
    status: 'ok',
    version,
    timestamp: new Date().toISOString(),
  });
};
